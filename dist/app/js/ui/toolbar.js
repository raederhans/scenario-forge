// Toolbar UI (Phase 13)
import {
  state as runtimeState,
  PARENT_BORDER_STYLE_DEFAULTS,
  PALETTE_THEMES,
  normalizeExportWorkbenchUiState,
  normalizeLakeStyleConfig,
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
  refreshResolvedColorsForFeatures,
  resetZoomToFit,
  recomputeDynamicBordersNow,
  scheduleDynamicBorderRecompute,
  zoomByStep,
  setZoomPercent,
  RENDER_PASS_NAMES,
  renderExportPassesToCanvas,
} from "../core/map_renderer/public.js";
import { captureHistoryState, canRedoHistory, canUndoHistory, pushHistoryEntry, redoHistory, undoHistory } from "../core/history_manager.js";
import { callCompatRuntimeHook, callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";
import { setExportBakeState } from "../core/state/actions/export_workbench_actions.js";
import {
  buildPaletteQuickSwatches,
  getPaletteSourceOptions,
  normalizeHexColor,
} from "../core/palette_manager.js";
import { buildExportArtifactPackage } from "../core/export_artifact_package.js";
import { ensureActiveScenarioOptionalLayerLoaded } from "../core/scenario_resources.js";
import { resetScenarioToBaselineCommand } from "../core/scenario_dispatcher.js";
import { toggleLanguage, updateUIText, t } from "./i18n.js";
import { markLegacyColorStateDirty, resetAllFeatureOwnersToCanonical } from "../core/sovereignty_manager.js";
import { showToast } from "./toast.js";
import { showAppDialog } from "./app_dialog.js";
import { createUiSurfaceUrlState } from "./ui_surface_url_state.js";
import { loadPublicSampleProjectIntoRuntime } from "../core/sample_project_import_workflow.js";
import { loadPublicSampleProjectList } from "../core/sample_project_registry.js";
import {
  applyDialogContract,
  createFocusReturnRegistry,
  focusSurface,
  getFocusableElements,
  rememberSurfaceTrigger,
  restoreSurfaceTriggerFocus,
  UI_URL_STATE_KEYS,
} from "./ui_contract.js";
import { markDirty, updateDirtyIndicator } from "../core/dirty_state.js";
import {
  createExportError,
  showExportFailureToast,
} from "./toolbar/export_failure_handler.js";
import {
  EXPORT_MAX_DIMENSION_PX,
  EXPORT_MAX_PIXELS,
  buildBakePackMetadata,
  buildBakePackPackageFiles,
  buildExportAdjustmentFilter,
  buildExportArtifactProjectContext,
  buildExportArtifactScenarioContext,
  buildExportUiManifestSnapshot,
  buildPerLayerExportPlan,
  buildPerLayerPackageFiles,
  getBakePackLayerIds,
  getBakePassNamesForLayer,
  resolveExportBaseDimensions,
} from "./toolbar/export_artifact_model.js";
import { createOceanLakeControlsController } from "./toolbar/ocean_lake_controls_controller.js";
import {
  EXPORT_BAKE_OUTPUT_MODELS,
  EXPORT_MAIN_LAYER_IDS,
  EXPORT_MAIN_LAYER_MODEL_BY_ID,
  EXPORT_TEXT_LAYER_IDS,
  EXPORT_TEXT_LAYER_MODEL_BY_ID,
  createExportWorkbenchController,
  normalizeExportWorkbenchLayerOrder as normalizeExportWorkbenchLayerOrderFromController,
  normalizeExportWorkbenchTextVisibility as normalizeExportWorkbenchTextVisibilityFromController,
  normalizeExportWorkbenchVisibility as normalizeExportWorkbenchVisibilityFromController,
  resolveExportPassSequence,
} from "./toolbar/export_workbench_controller.js";
import { createPaletteLibraryPanelController, selectPalettePaintColor } from "./toolbar/palette_library_panel.js";
import { createPaletteLibraryOperation } from "../core/palette_library_operation.js";
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
} from "./toolbar/transport_workbench_controller.js";
import { createWorkspaceChromeSupportSurfaceController } from "./toolbar/workspace_chrome_support_surface_controller.js";
import { createHgoRuntimePreviewLoaders } from "../core/hgo_runtime_asset_loader.js";
import { createHgoRuntimePreviewToolbarController } from "./toolbar/hgo_runtime_preview_controller.js";
const state = runtimeState;

function composePaletteLibraryOperation() {
  const stateAccess = createPaletteLibraryStateAccess(runtimeState);
  const owner = createPaletteLibraryOperation({
    getApplyTarget: stateAccess.getApplyTarget,
    getOwnerFeatureIds: stateAccess.getOwnerFeatureIds,
    applyFeatureColor: stateAccess.applyFeatureColor,
    applyOwnerColor: stateAccess.applyOwnerColor,
    captureHistoryState,
    pushHistoryEntry,
    markLegacyColorStateDirty,
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
      callRuntimeHook(state, "updateSwatchUIFn");
    });
    paletteGrid.appendChild(btn);
  });

  if (!normalizeHexColor(runtimeState.selectedColor) && swatches.length > 0) {
    runtimeState.selectedColor = swatches[0];
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

const EXPORT_MAX_CONCURRENT_JOBS = 1;


function initToolbar({ render } = {}) {
  // toolbar.js 保留的是壳层接线职责：集中拿 DOM、拼 controller、注册 runtime hooks。
  // 各个面板自身的业务逻辑应继续留在子 controller，避免再把 owner 逻辑回流到这个大文件。
  const OCEAN_ADVANCED_PRESETS = new Set([
    "bathymetry_soft",
    "bathymetry_contours",
  ]);
  const toolButtons = document.querySelectorAll(".btn-tool");
  const customColor = document.getElementById("customColor");
  const exportBtn = document.getElementById("exportWorkbenchSnapshotBtn");
  const exportTarget = document.getElementById("exportWorkbenchTarget");
  const exportFormat = document.getElementById("exportWorkbenchFormat");
  const exportScale = document.getElementById("exportWorkbenchScale");
  const exportWorkbenchLayerList = document.getElementById("exportWorkbenchMainLayerList");
  const exportWorkbenchTextElementList = document.getElementById("exportWorkbenchTextElementList");
  if (exportWorkbenchLayerList && !exportWorkbenchLayerList.getAttribute("aria-label")) {
    exportWorkbenchLayerList.setAttribute("aria-label", t("Main Layers", "ui"));
  }
  if (exportWorkbenchTextElementList && !exportWorkbenchTextElementList.getAttribute("aria-label")) {
    exportWorkbenchTextElementList.setAttribute("aria-label", t("Text elements", "ui"));
  }
  const transportAppearanceWorkbenchBtn = document.getElementById("transportAppearanceWorkbenchBtn");
  const toggleWaterRegions = document.getElementById("toggleWaterRegions");
  const toggleOpenOceanRegions = document.getElementById("toggleOpenOceanRegions");
  const specialZoneEditorHint = document.getElementById("specialZoneEditorHint");
  const recentContainer = document.getElementById("recentColors");
  const paletteLibraryToggle = document.getElementById("paletteLibraryToggle");
  const paletteLibraryPanel = document.getElementById("paletteLibraryPanel");
  const paletteLibrarySources = document.getElementById("paletteLibrarySources");
  const paletteLibrarySearch = document.getElementById("paletteLibrarySearch");
  const paletteLibrarySearchClear = document.getElementById("paletteLibrarySearchClear");
  const paletteLibrarySummary = document.getElementById("paletteLibrarySummary");
  const paletteLibraryList = document.getElementById("paletteLibraryList");
  const dockRecentDivider = document.getElementById("dockRecentDivider");
  const presetPolitical = document.getElementById("presetPolitical");
  const presetClear = document.getElementById("presetClear");
  const dockQuickFillBtn = document.getElementById("dockQuickFillBtn");
  const colorModeSelect = document.getElementById("colorModeSelect");
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
  const dockConfigGroup = document.getElementById("dockConfigGroup");
  const dockReferenceBtn = document.getElementById("dockReferenceBtn");
  const dockExportBtn = document.getElementById("dockExportBtn");
  const sampleProjectBanner = document.getElementById("sampleProjectBanner");
  const sampleProjectBannerTitle = document.getElementById("sampleProjectBannerTitle");
  const sampleProjectBannerBody = document.getElementById("sampleProjectBannerBody");
  const sampleProjectBannerOpenExportBtn = document.getElementById("sampleProjectBannerOpenExportBtn");
  const sampleProjectBannerDownloadOriginalLink = document.getElementById("sampleProjectBannerDownloadOriginalLink");
  const sampleProjectBannerDismissBtn = document.getElementById("sampleProjectBannerDismissBtn");
  const dockEditPopoverBtn = document.getElementById("dockEditPopoverBtn");
  const dockReferencePopover = document.getElementById("dockReferencePopover");
  const dockEditPopover = document.getElementById("dockEditPopover");
  const devWorkspaceToggleBtn = document.getElementById("devWorkspaceToggleBtn");
  const leftPanelToggle = document.getElementById("leftPanelToggle");
  const rightPanelToggle = document.getElementById("rightPanelToggle");
  const inspectorSidebarTabProject = document.getElementById("inspectorSidebarTabProject");
  const inspectorUtilitiesSection = document.getElementById("inspectorUtilitiesSection");
  const exportProjectSection = document.getElementById("exportProjectSection");
  const exportSectionSummaryTarget = document.getElementById("exportSectionSummaryTarget");
  const exportSectionSummaryFormat = document.getElementById("exportSectionSummaryFormat");
  const exportSectionSummaryScale = document.getElementById("exportSectionSummaryScale");
  const transportWorkbenchOverlay = document.getElementById("transportWorkbenchOverlay");
  const transportWorkbenchPanel = document.getElementById("transportWorkbenchPanel");
  const exportWorkbenchOverlay = document.getElementById("exportWorkbenchOverlay");
  const exportWorkbenchPanel = document.getElementById("exportWorkbenchPanel");
  const exportWorkbenchCloseBtn = document.getElementById("exportWorkbenchCloseBtn");
  const exportWorkbenchPreviewStage = document.getElementById("exportWorkbenchPreviewStage");
  const exportWorkbenchPreviewState = document.getElementById("exportWorkbenchPreviewState");
  const exportWorkbenchPreviewModeButtons = Array.from(document.querySelectorAll(".export-workbench-preview-toggle-btn"));
  const exportWorkbenchPreviewLayerSelect = document.getElementById("exportWorkbenchPreviewLayerSelect");
  const exportWorkbenchTarget = document.getElementById("exportWorkbenchTarget");
  const exportWorkbenchFormat = document.getElementById("exportWorkbenchFormat");
  const exportWorkbenchScale = document.getElementById("exportWorkbenchScale");
  const exportWorkbenchSnapshotBtn = document.getElementById("exportWorkbenchSnapshotBtn");
  const exportWorkbenchBrightness = document.getElementById("exportWorkbenchBrightness");
  const exportWorkbenchContrast = document.getElementById("exportWorkbenchContrast");
  const exportWorkbenchSaturation = document.getElementById("exportWorkbenchSaturation");
  const exportWorkbenchClarity = document.getElementById("exportWorkbenchClarity");
  const exportWorkbenchBrightnessValue = document.getElementById("exportWorkbenchBrightnessValue");
  const exportWorkbenchContrastValue = document.getElementById("exportWorkbenchContrastValue");
  const exportWorkbenchSaturationValue = document.getElementById("exportWorkbenchSaturationValue");
  const exportWorkbenchClarityValue = document.getElementById("exportWorkbenchClarityValue");
  const exportWorkbenchBakeVisibleBtn = document.getElementById("exportWorkbenchBakeVisibleBtn");
  const exportWorkbenchClearBakeBtn = document.getElementById("exportWorkbenchClearBakeBtn");
  const exportWorkbenchBakeArtifactList = document.getElementById("exportWorkbenchBakeArtifactList");
  const exportWorkbenchSampleContext = document.getElementById("exportWorkbenchSampleContext");
  const exportWorkbenchSampleTitle = document.getElementById("exportWorkbenchSampleTitle");
  const exportWorkbenchSampleRecommendation = document.getElementById("exportWorkbenchSampleRecommendation");
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
  const paintGranularitySelect = document.getElementById("paintGranularitySelect");
  const dockGranularityField = document.getElementById("dockGranularityField");
  const dockQuickFillRow = document.getElementById("dockQuickFillRow");
  const quickFillParentBtn = document.getElementById("quickFillParentBtn");
  const quickFillCountryBtn = document.getElementById("quickFillCountryBtn");
  const dockQuickFillHint = document.getElementById("dockQuickFillHint");
  const paintModeSelect = document.getElementById("paintModeSelect");
  const paintModeVisualBtn = document.getElementById("paintModeVisualBtn");
  const paintModePoliticalBtn = document.getElementById("paintModePoliticalBtn");
  const politicalEditingToggleBtn = document.getElementById("politicalEditingToggleBtn");
  const dockPoliticalEditingPanel = document.getElementById("dockPoliticalEditingPanel");
  const dockColorModeField = document.getElementById("dockColorModeField");
  const activeSovereignLabel = document.getElementById("activeSovereignLabel");
  const recalculateBordersBtn = document.getElementById("recalculateBordersBtn");
  const dynamicBorderStatus = document.getElementById("dynamicBorderStatus");
  const oceanFillColor = document.getElementById("oceanFillColor");
  const lakeLinkToOcean = document.getElementById("lakeLinkToOcean");
  const lakeFillColor = document.getElementById("lakeFillColor");
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
  const oceanShallowFadeEndZoom = document.getElementById("oceanShallowFadeEndZoom");
  const oceanMidFadeEndZoom = document.getElementById("oceanMidFadeEndZoom");
  const oceanDeepFadeEndZoom = document.getElementById("oceanDeepFadeEndZoom");
  const oceanScenarioSyntheticContourFadeEndZoom = document.getElementById("oceanScenarioSyntheticContourFadeEndZoom");
  const oceanScenarioShallowContourFadeEndZoom = document.getElementById("oceanScenarioShallowContourFadeEndZoom");
  const toggleLang = document.getElementById("btnToggleLang");
  const scenarioGuideLanguageToggle = document.getElementById("scenarioGuideLanguageToggle");
  const themeSelect = document.getElementById("themeSelect");
  const paletteLibraryToggleLabel = document.getElementById("paletteLibraryToggleLabel");

  const oceanTextureOpacityValue = document.getElementById("oceanTextureOpacityValue");
  const oceanTextureScaleValue = document.getElementById("oceanTextureScaleValue");
  const oceanContourStrengthValue = document.getElementById("oceanContourStrengthValue");
  const oceanShallowFadeEndZoomValue = document.getElementById("oceanShallowFadeEndZoomValue");
  const oceanMidFadeEndZoomValue = document.getElementById("oceanMidFadeEndZoomValue");
  const oceanDeepFadeEndZoomValue = document.getElementById("oceanDeepFadeEndZoomValue");
  const oceanScenarioSyntheticContourFadeEndZoomValue = document.getElementById("oceanScenarioSyntheticContourFadeEndZoomValue");
  const oceanScenarioShallowContourFadeEndZoomValue = document.getElementById("oceanScenarioShallowContourFadeEndZoomValue");
  const appearanceLayerFilter = document.getElementById("appearanceLayerFilter");
  const appearanceFilterItems = Array.from(document.querySelectorAll("[data-appearance-filter-item]"));
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
  let hgoRuntimePreviewController = null;

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

  const syncDeveloperModeUi = () => {
    document.body?.classList.toggle("developer-mode", !!runtimeState.ui.developerMode);
    if (developerModeBtn) {
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
    hgoRuntimePreviewController?.sync?.();
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

  try {
    const storedDeveloperMode = globalThis.localStorage?.getItem(DEVELOPER_MODE_STORAGE_KEY);
    if (storedDeveloperMode === "true" || storedDeveloperMode === "false") {
      runtimeState.ui.developerMode = storedDeveloperMode === "true";
    }
  } catch {}
  const hgoRuntimePreviewLoaders = createHgoRuntimePreviewLoaders({
    d3Client: globalThis.d3,
    fetchImpl: globalThis.fetch,
  });
  hgoRuntimePreviewController = createHgoRuntimePreviewToolbarController({
    runtimeState,
    anchorButton: developerModeBtn,
    canvas: runtimeState.colorCanvas || document.getElementById("colorCanvas"),
    loadSeed: hgoRuntimePreviewLoaders.loadSeed,
    loadRaster: hgoRuntimePreviewLoaders.loadRaster,
    renderOptions: () => callRuntimeHook(state, "getHgoRuntimePreviewProjectionOptionsFn") || {},
    restorePreviewTarget: render,
    storage: globalThis.localStorage,
    documentRef: document,
  });
  updateLanguageToggleUi();
  syncDeveloperModeUi();

  const focusOverlaySurface = (container) => focusSurface(container);
  const rememberOverlayTrigger = (overlay, trigger) => rememberSurfaceTrigger(overlayFocusReturnTargets, overlay, trigger);
  const restoreOverlayTriggerFocus = (overlay, explicitTrigger = null) => (
    restoreSurfaceTriggerFocus(overlayFocusReturnTargets, overlay, explicitTrigger)
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
  const getExportBakeVisibilitySignature = (exportUi) => {
    const main = EXPORT_MAIN_LAYER_IDS
      .map((layerId) => `${layerId}:${exportUi?.visibility?.[layerId] === false ? "0" : "1"}`)
      .join("|");
    const text = EXPORT_TEXT_LAYER_IDS
      .map((layerId) => `${layerId}:${exportUi?.textVisibility?.[layerId] === false ? "0" : "1"}`)
      .join("|");
    return `main=${main};text=${text}`;
  };

  let exportWorkbenchController = null;
  const exportBakeCache = new Map();
  const clearExportBakeCache = () => exportBakeCache.clear();
  let ensureExportWorkbenchUiState = () => {
    throw new Error("Export workbench controller is not initialized.");
  };
  const renderExportWorkbenchLayerList = () => exportWorkbenchController?.renderExportWorkbenchLayerList();
  const renderExportWorkbenchTextElementList = () => exportWorkbenchController?.renderExportWorkbenchTextElementList();
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
    dockEditPopoverBtn,
    dockQuickFillBtn,
    dockReferencePopover,
    dockEditPopover,
    dockQuickFillRow,
    quickFillParentBtn,
    quickFillCountryBtn,
    dockQuickFillHint,
    refreshPaintModeUi: () => {
      if (typeof runtimeState.updatePaintModeUIFn === "function") runtimeState.updatePaintModeUIFn();
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
    ensureRightPanelVisible: () => runtimeState.toggleRightPanelFn?.(true),
    openExportWorkbench: (trigger = dockExportBtn) => runtimeState.openExportWorkbenchFn?.(trigger),
    closeExportWorkbench: ({ restoreFocus = true } = {}) => runtimeState.closeExportWorkbenchFn?.({ restoreFocus }),
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
  drawerMedia.addEventListener("change", syncPanelToggleButtons);

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
  registerRuntimeHook(state, "setHgoRuntimePreviewEnabledFn", (nextEnabled) => (
    hgoRuntimePreviewController?.setEnabled?.(nextEnabled)
  ));
  registerRuntimeHook(state, "toggleHgoRuntimePreviewFn", () => (
    hgoRuntimePreviewController?.toggle?.()
  ));
  registerRuntimeHook(state, "syncHgoRuntimePreviewUiFn", () => (
    hgoRuntimePreviewController?.sync?.()
  ));
  registerRuntimeHook(state, "renderHgoRuntimePreviewFn", (options = {}) => (
    hgoRuntimePreviewController?.renderPreview?.(options) || null
  ));
  registerRuntimeHook(state, "inspectHgoRuntimePreviewPointFn", (x, y, options = {}) => (
    hgoRuntimePreviewController?.inspectPoint?.(x, y, options) || null
  ));

  const syncExportPreviewSourceOptions = () => {
    return exportWorkbenchController?.syncExportPreviewSourceOptions();
  };

  const renderExportWorkbenchBakeArtifactList = () => {
    return exportWorkbenchController?.renderExportWorkbenchBakeArtifactList();
  };

  const renderExportWorkbenchPreview = async () => {
    return exportWorkbenchController?.renderExportWorkbenchPreview();
  };

  const renderExportWorkbenchUi = (isOpen) => {
    if (!exportWorkbenchOverlay) return;
    exportWorkbenchOverlay.classList.toggle("hidden", !isOpen);
    exportWorkbenchOverlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    dockExportBtn?.classList.toggle("is-active", isOpen);
    dockExportBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    return exportWorkbenchController?.renderExportWorkbenchUi(isOpen);
  };

  const setExportWorkbenchState = (nextOpen, { trigger = null, restoreFocus = true } = {}) => {
    if (!exportWorkbenchOverlay || !exportWorkbenchPanel) return;
    const willOpen = !!nextOpen;
    const wasOpen = !exportWorkbenchOverlay.classList.contains("hidden");
    if (willOpen === wasOpen) {
      renderExportWorkbenchUi(willOpen);
      return;
    }
    if (willOpen) {
      closeDockPopover({ restoreFocus: false, syncUrl: false });
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
        closeScenarioGuidePopover({ restoreFocus: false, syncUrl: false });
      }
      if (exportProjectSection instanceof HTMLDetailsElement) {
        exportProjectSection.open = true;
      }
      if (trigger instanceof HTMLElement) {
        rememberOverlayTrigger(exportWorkbenchOverlay, trigger);
      }
      renderExportWorkbenchUi(true);
      syncSupportSurfaceUrlState("export");
      focusOverlaySurface(exportWorkbenchPanel);
      return;
    }
    renderExportWorkbenchUi(false);
    syncSupportSurfaceUrlState("");
    if (restoreFocus) {
      restoreOverlayTriggerFocus(exportWorkbenchOverlay);
    }
  };

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
      runtimeState.openExportWorkbenchFn?.(resolveExportWorkbenchFocusReturnTrigger(trigger))
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
      runtimeState.openExportWorkbenchFn?.(resolveExportWorkbenchFocusReturnTrigger(trigger))
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

  const getPaintModeLabel = () => (
    String(runtimeState.paintMode || "visual") === "sovereignty"
      ? t("Political Ownership", "ui")
      : t("Visual Color", "ui")
  );

  const getPrimaryActionLabel = () => (
    String(runtimeState.paintMode || "visual") === "sovereignty"
      ? t("Auto-Fill Ownership", "ui")
      : t("Auto-Fill Visuals", "ui")
  );

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
      return `${t(label, "geo") || label} (${selectedCode})`;
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
    const isOwnershipMode = String(runtimeState.paintMode || "visual") === "sovereignty";
    const showPoliticalPanel = !isScenarioMode && (runtimeState.ui.politicalEditingExpanded || isOwnershipMode);
    const showBorderMaintenance = isScenarioMode || runtimeState.ui.politicalEditingExpanded || isOwnershipMode;
    const showGranularityField = !isScenarioMode;
    const showColorModeField = !isOwnershipMode;
    const showPoliticalEditingToggle = !isScenarioMode;
    const showEditConfigButton = showGranularityField || showColorModeField || showPoliticalEditingToggle || showPoliticalPanel;
    const primaryActionLabel = getPrimaryActionLabel();

    if (document.getElementById("labelPresetPolitical")) {
      document.getElementById("labelPresetPolitical").textContent = primaryActionLabel;
    }
    if (presetPolitical) {
      presetPolitical.setAttribute("aria-label", primaryActionLabel);
      presetPolitical.setAttribute("title", primaryActionLabel);
    }

    if (dockGranularityField) {
      dockGranularityField.classList.toggle("hidden", !showGranularityField);
    }

    if (dockColorModeField) {
      dockColorModeField.classList.toggle("hidden", !showColorModeField);
    }

    if (politicalEditingToggleBtn) {
      politicalEditingToggleBtn.classList.toggle("hidden", !showPoliticalEditingToggle);
      politicalEditingToggleBtn.classList.toggle("is-active", showPoliticalPanel);
      politicalEditingToggleBtn.setAttribute("aria-expanded", String(showPoliticalPanel));
    }

    if (dockPoliticalEditingPanel) {
      dockPoliticalEditingPanel.classList.toggle("hidden", !showPoliticalPanel);
      dockPoliticalEditingPanel.setAttribute("aria-hidden", showPoliticalPanel ? "false" : "true");
    }

    if (!showEditConfigButton && runtimeState.activeDockPopover === "edit") {
      closeDockPopover();
    }
    if (dockEditPopoverBtn) {
      dockEditPopoverBtn.classList.toggle("hidden", !showEditConfigButton);
      dockEditPopoverBtn.setAttribute("aria-hidden", showEditConfigButton ? "false" : "true");
    }
    if (dockConfigGroup) {
      dockConfigGroup.classList.toggle("hidden", !showEditConfigButton);
      dockConfigGroup.setAttribute("aria-hidden", showEditConfigButton ? "false" : "true");
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
      dockHandleChevron.textContent = runtimeState.ui.dockCollapsed ? "^" : "v";
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
        : "Fill",
    "ui"
  );

  const setToolCursorClass = () => {
    if (!mapContainer) return;
    mapContainer.classList.remove("tool-fill", "tool-eraser", "tool-eyedropper", "tool-special-zone", "tool-pan-override");
    if (runtimeState.specialZoneEditor?.active || runtimeState.currentTool === "special-zone-membership") {
      mapContainer.classList.add("tool-special-zone");
      return;
    }
    if (runtimeState.brushModeEnabled && runtimeState.brushPanModifierActive) {
      mapContainer.classList.add("tool-pan-override");
      return;
    }
    mapContainer.classList.add(`tool-${runtimeState.currentTool || "fill"}`);
  };

  const renderDirty = (reason) => {
    markDirty(reason);
    if (render) render();
  };

  const addRecentColor = (color) => {
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
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
        activeSovereignLabel.textContent = `${t(label, "geo") || label} (${code})`;
      }
    }
    refreshScenarioContextBar();
    refreshWorkspaceStatus();
    if (typeof runtimeState.renderPresetTreeFn === "function") {
      runtimeState.renderPresetTreeFn();
    }
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
  const refreshPaintModeUi = () => {
    if (paintModeSelect) {
      paintModeSelect.value = runtimeState.paintMode || "visual";
    }
    const isOwnershipMode = String(runtimeState.paintMode || "visual") === "sovereignty";
    [paintModeVisualBtn, paintModePoliticalBtn].forEach((button) => {
      if (!button) return;
      const buttonMode = button.dataset.paintMode || "visual";
      const isActive = (buttonMode === "sovereignty") === isOwnershipMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (paintGranularitySelect) {
      paintGranularitySelect.value = runtimeState.interactionGranularity || "subdivision";
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
  runtimeState.styleConfig.ocean.preset = normalizeOceanPreset(runtimeState.styleConfig.ocean.preset || "flat");
  runtimeState.styleConfig.ocean.experimentalAdvancedStyles = runtimeState.styleConfig.ocean.experimentalAdvancedStyles === true;
  if (!runtimeState.styleConfig.ocean.experimentalAdvancedStyles && OCEAN_ADVANCED_PRESETS.has(runtimeState.styleConfig.ocean.preset)) {
    runtimeState.styleConfig.ocean.preset = "flat";
  }
  runtimeState.styleConfig.ocean.coastalAccentEnabled = runtimeState.styleConfig.ocean.coastalAccentEnabled !== false;
  runtimeState.styleConfig.ocean.fillColor = normalizeOceanFillColor(runtimeState.styleConfig.ocean.fillColor);
  runtimeState.styleConfig.ocean.opacity = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.opacity)) ? Number(runtimeState.styleConfig.ocean.opacity) : 0.72,
    0,
    1
  );
  runtimeState.styleConfig.ocean.scale = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scale)) ? Number(runtimeState.styleConfig.ocean.scale) : 1,
    0.6,
    2.4
  );
  runtimeState.styleConfig.ocean.contourStrength = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.contourStrength))
      ? Number(runtimeState.styleConfig.ocean.contourStrength)
      : 0.75,
    0,
    1
  );
  runtimeState.styleConfig.ocean.shallowBandFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.shallowBandFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.shallowBandFadeEndZoom)
      : 2.8,
    2.1,
    4.8
  );
  runtimeState.styleConfig.ocean.midBandFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.midBandFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.midBandFadeEndZoom)
      : 3.4,
    2.7,
    5.2
  );
  runtimeState.styleConfig.ocean.deepBandFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.deepBandFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.deepBandFadeEndZoom)
      : 4.2,
    3.3,
    6
  );
  runtimeState.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.scenarioSyntheticContourFadeEndZoom)
      : 3.0,
    2.1,
    4.6
  );
  runtimeState.styleConfig.ocean.scenarioShallowContourFadeEndZoom = clamp(
    Number.isFinite(Number(runtimeState.styleConfig.ocean.scenarioShallowContourFadeEndZoom))
      ? Number(runtimeState.styleConfig.ocean.scenarioShallowContourFadeEndZoom)
      : 3.4,
    2.5,
    5
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
    "#666666"
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
      : 1,
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
  runtimeState.parentBordersVisible = runtimeState.parentBordersVisible !== false;

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
    syncPaletteSourceControls,
    syncPanelVisibility: syncPaletteLibraryPanelVisibility,
  } = paletteLibraryPanelController;
  handlePaletteLibraryResizeForWorkspace = handlePaletteLibraryResize;
  registerRuntimeHook(state, "updatePaletteSourceUIFn", syncPaletteSourceControls);
  registerRuntimeHook(state, "renderPaletteFn", renderPalette);

  registerRuntimeHook(state, "updatePaletteLibraryUIFn", renderPaletteLibrary);

  function renderSpecialZoneEditorUI() {
    if (toggleWaterRegions) toggleWaterRegions.checked = !!runtimeState.showWaterRegions;
    if (toggleOpenOceanRegions) toggleOpenOceanRegions.checked = !!runtimeState.showOpenOceanRegions;
    renderAppearanceStyleControlsUi();
    specialZoneEditorController.renderSpecialZoneEditorUI();
    specialZonesWorkbenchController.renderSpecialZonesWorkbenchUi();
    updateToolUI();
  }
  registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);

  function updateSwatchUI() {
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
    updateDirtyIndicator();
  }
  registerRuntimeHook(state, "updateToolUIFn", updateToolUI);

  const appearanceControlsController = createAppearanceControlsController({
    runtimeState: state,
    t,
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
    applyAppearanceFilter,
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
  registerRuntimeHook(state, "updateRecentUI", () => {
    renderRecentColors();
    renderPalette(runtimeState.currentPaletteTheme);
    renderPaletteLibrary();
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
    lakeLinkToOcean,
    lakeFillColor,
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
  exportWorkbenchController = createExportWorkbenchController({
    state,
    t,
    showToast,
    showExportFailureToast,
    normalizeExportWorkbenchUiState,
    renderPassNames: RENDER_PASS_NAMES,
    exportBtn,
    exportTarget,
    exportFormat,
    exportScale,
    exportWorkbenchLayerList,
    exportWorkbenchTextElementList,
    exportWorkbenchOverlay,
    exportWorkbenchPreviewStage,
    exportWorkbenchPreviewState,
    exportWorkbenchPreviewModeButtons,
    exportWorkbenchPreviewLayerSelect,
    exportWorkbenchBrightness,
    exportWorkbenchContrast,
    exportWorkbenchSaturation,
    exportWorkbenchClarity,
    exportWorkbenchBrightnessValue,
    exportWorkbenchContrastValue,
    exportWorkbenchSaturationValue,
    exportWorkbenchClarityValue,
    exportWorkbenchBakeVisibleBtn,
    exportWorkbenchClearBakeBtn,
    exportWorkbenchBakeArtifactList,
    exportWorkbenchSampleContext,
    exportWorkbenchSampleTitle,
    exportWorkbenchSampleRecommendation,
    exportWorkbenchCloseBtn,
    dockExportBtn,
    exportSectionSummaryTarget,
    exportSectionSummaryFormat,
    exportSectionSummaryScale,
    onRequestClose: ({ restoreFocus = true } = {}) => {
      callRuntimeHook(state, "closeExportWorkbenchFn", { restoreFocus });
    },
    buildCompositeSourceCanvas: (...args) => buildCompositeSourceCanvas(...args),
    buildSingleExportSourceCanvas: (...args) => buildSingleExportSourceCanvas(...args),
    applyExportAdjustmentsToCanvas: (...args) => applyExportAdjustmentsToCanvas(...args),
    buildPerLayerExportOutputs: (...args) => buildPerLayerExportOutputs(...args),
    buildPerLayerExportPackage: (...args) => buildPerLayerExportPackage(...args),
    buildBakePackOutputs: (...args) => buildBakePackOutputs(...args),
    buildBakePackPackage: (...args) => buildBakePackPackage(...args),
    buildCompositeExportCanvas: (...args) => buildCompositeExportCanvas(...args),
    getSelectedExportScale: (...args) => getSelectedExportScale(...args),
    triggerCanvasDownload: (...args) => triggerCanvasDownload(...args),
    triggerBlobDownload: (...args) => triggerBlobDownload(...args),
    bakeLayer: (...args) => bakeLayer(...args),
    clearBakeCache: clearExportBakeCache,
    exportMaxConcurrentJobs: EXPORT_MAX_CONCURRENT_JOBS,
  });
  ensureExportWorkbenchUiState = exportWorkbenchController.ensureExportWorkbenchUiState;
  registerRuntimeHook(state, "clearExportBakeCacheFn", clearExportBakeCache);
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
    const nextTool = tool || "fill";
    runtimeState.currentTool = nextTool;
    if (nextTool === "eyedropper") {
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
    if (runtimeState.brushModeEnabled && runtimeState.currentTool === "eyedropper") {
      runtimeState.currentTool = "fill";
    }
    updateToolUI();
    if (dismissHint) {
      dismissOnboardingHint();
    }
    emitTransientFeedback(t(
      runtimeState.brushModeEnabled ? "Brush On · Shift+Drag to pan" : "Brush Off",
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
    resetZoomToFit();
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
    if (colorModeSelect) {
      colorModeSelect.value = runtimeState.colorMode || "political";
    }
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
      commitZoomInputValue();
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
    if (!drawerMedia.matches || drawerBackdrop?.classList.contains("hidden")) return;
    // An open dialog owns Escape and focus until it closes.
    if (document.activeElement?.closest('[role="dialog"], dialog')) return;
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

  const workspaceExportBtn = document.getElementById("workspaceExportBtn");
  workspaceExportBtn?.addEventListener("click", () => callCompatRuntimeHook(runtimeState, "openExportWorkbenchFn", workspaceExportBtn));
  const advancedExportBtn = document.getElementById("exportWorkbenchAdvancedBtn");
  const setAdvancedExport = (expanded) => {
    advancedExportBtn?.setAttribute("aria-expanded", String(expanded));
    document.getElementById("exportWorkbenchPanel")?.classList.toggle("is-advanced", expanded);
    for (const id of ["exportWorkbenchParams", "exportWorkbenchLayers"]) {
      const section = document.getElementById(id);
      if (section) section.hidden = !expanded;
    }
  };
  advancedExportBtn?.addEventListener("click", () => setAdvancedExport(advancedExportBtn.getAttribute("aria-expanded") !== "true"));
  exportTarget?.addEventListener("change", () => {
    if (exportTarget.value !== "composite") setAdvancedExport(true);
  });

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
      runtimeState.toggleDeveloperModeFn?.();
    });
    developerModeBtn.dataset.bound = "true";
  }

  [paintModeVisualBtn, paintModePoliticalBtn].forEach((button) => {
    if (!button || button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      const nextMode = button.dataset.paintMode || "visual";
      if (paintModeSelect) {
        paintModeSelect.value = nextMode;
      }
      runtimeState.paintMode = nextMode;
      runtimeState.ui.politicalEditingExpanded = nextMode === "sovereignty";
      markDirty?.("paint-mode");
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
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
    dockExportBtn.setAttribute("aria-controls", "exportWorkbenchOverlay");
    dockExportBtn.addEventListener("click", () => {
      const isOpen = !!(exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden"));
      if (isOpen) {
        runtimeState.closeExportWorkbenchFn?.({ restoreFocus: true });
      } else {
        closeDockPopover?.({ restoreFocus: false, syncUrl: true });
        runtimeState.openExportWorkbenchFn?.(dockExportBtn);
      }
    });
    dockExportBtn.dataset.bound = "true";
  }
  exportWorkbenchController.bindExportWorkbenchEvents();

  if (dockCollapseBtn && !dockCollapseBtn.dataset.bound) {
    dockCollapseBtn.addEventListener("click", () => {
      toggleDock();
    });
    dockCollapseBtn.dataset.bound = "true";
  }

  if (dockEditPopoverBtn && !dockEditPopoverBtn.dataset.bound) {
    dockEditPopoverBtn.setAttribute("aria-haspopup", "dialog");
    dockEditPopoverBtn.setAttribute("aria-controls", "dockEditPopover");
    dockEditPopoverBtn.addEventListener("click", () => {
      openDockPopover("edit");
    });
    dockEditPopoverBtn.dataset.bound = "true";
  }

  bindQuickFillControls();

  if (politicalEditingToggleBtn && !politicalEditingToggleBtn.dataset.bound) {
    politicalEditingToggleBtn.addEventListener("click", () => {
      runtimeState.ui.politicalEditingExpanded = !runtimeState.ui.politicalEditingExpanded;
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
      }
    });
    politicalEditingToggleBtn.dataset.bound = "true";
  }

  bindScenarioContextBarEvents();

  bindScenarioGuideEvents({
    onToggle: (trigger) => {
      toggleScenarioGuidePopover(trigger);
    },
    onClose: () => {
      closeScenarioGuidePopover({ restoreFocus: true });
    },
  });

  bindDockPopoverDismiss();
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(() => {
      restoreSupportSurfaceFromUrl();
    });
  });

  const computeBakeHash = (parts) => {
    const source = Array.isArray(parts) ? parts.join("|") : String(parts || "");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };

  const getLayerDependencyRevision = (layerId, exportUi = ensureExportWorkbenchUiState()) => {
    const mapSvg = document.getElementById("map-svg");
    const mapSvgChildCount = mapSvg ? mapSvg.childElementCount : 0;
    const renderPassCache = runtimeState.renderPassCache && typeof runtimeState.renderPassCache === "object"
      ? runtimeState.renderPassCache
      : {};
    const signatures = renderPassCache.signatures && typeof renderPassCache.signatures === "object"
      ? renderPassCache.signatures
      : {};
    const dirtyRevision = Number(runtimeState.dirtyRevision || 0);
    const zoomTransform = runtimeState.zoomTransform && typeof runtimeState.zoomTransform === "object"
      ? runtimeState.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const transformSignature = [
      `zoomK:${Number(zoomTransform.k || 1).toFixed(5)}`,
      `zoomX:${Number(zoomTransform.x || 0).toFixed(2)}`,
      `zoomY:${Number(zoomTransform.y || 0).toFixed(2)}`,
    ];
    if (layerId === "color") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `colorRevision:${Number(runtimeState.colorRevision) || 0}`,
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBackground:${String(signatures.background || "")}`,
        `passPhysicalBase:${String(signatures.physicalBase || "")}`,
        `passPolitical:${String(signatures.political || "")}`,
        `passContextBase:${String(signatures.contextBase || "")}`,
        `passContextScenario:${String(signatures.contextScenario || "")}`,
        `passEffects:${String(signatures.effects || "")}`,
        `passDayNight:${String(signatures.dayNight || "")}`,
      ];
    }
    if (layerId === "line") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `dynamicDirty:${runtimeState.dynamicBordersDirty ? 1 : 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBorders:${String(signatures.borders || "")}`,
        `passLineEffects:${String(signatures.lineEffects || "")}`,
      ];
    }
    if (layerId === "text") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `svgChildren:${mapSvgChildCount}`,
        `dirtyRevision:${dirtyRevision}`,
        ...transformSignature,
      ];
    }
    return [
      getExportBakeVisibilitySignature(exportUi),
      `colorRevision:${Number(runtimeState.colorRevision) || 0}`,
      `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
      `svgChildren:${mapSvgChildCount}`,
      `dirtyRevision:${dirtyRevision}`,
      ...transformSignature,
      `passPolitical:${String(signatures.political || "")}`,
      `passContextBase:${String(signatures.contextBase || "")}`,
      `passContextScenario:${String(signatures.contextScenario || "")}`,
      `passEffects:${String(signatures.effects || "")}`,
      `passBorders:${String(signatures.borders || "")}`,
      `passLineEffects:${String(signatures.lineEffects || "")}`,
      `passDayNight:${String(signatures.dayNight || "")}`,
      `passContextMarkers:${String(signatures.contextMarkers || "")}`,
      `passTextureLabels:${String(signatures.textureLabels || "")}`,
      `passLabels:${String(signatures.labels || "")}`,
    ];
  };

  const SVG_ANNOTATION_VIEWPORT_SELECTOR = [
    ".frontline-overlay-layer",
    ".frontline-labels-layer",
    ".operational-lines-layer",
    ".operation-graphics-layer",
    ".unit-counters-layer",
  ].join(", ");
  const cloneSvgForExport = ({ onlyViewportSelector = "", removeSelectors = [] } = {}) => {
    const mapSvg = document.getElementById("map-svg");
    if (!mapSvg) return null;
    const clone = mapSvg.cloneNode(true);
    removeSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    });
    if (onlyViewportSelector) {
      const viewport = clone.querySelector(".viewport-layer");
      if (viewport) {
        Array.from(viewport.children).forEach((child) => {
          if (!child.matches(onlyViewportSelector)) child.remove();
        });
      }
      Array.from(clone.children).forEach((child) => {
        const tagName = String(child.tagName || "").toLowerCase();
        if (child !== viewport && tagName !== "defs") child.remove();
      });
    }
    return clone;
  };

  const drawSvgLayerToCanvas = async (targetCanvas, targetCtx, options = {}) => {
    const svgForExport = cloneSvgForExport(options);
    if (!svgForExport || !targetCanvas || !targetCtx) return false;
    const serializer = new XMLSerializer();
    const svgMarkup = serializer.serializeToString(svgForExport);
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          targetCtx.drawImage(image, 0, 0);
          resolve();
        };
        image.onerror = () => reject(new Error("SVG overlay export failed."));
        image.src = svgUrl;
      });
      return true;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const writeBakeArtifactMeta = (layerId, dependencies, canvas, dirtyFlag) => {
    const exportUi = ensureExportWorkbenchUiState();
    const entry = {
      layerId,
      updatedAt: Date.now(),
      dependencies: [...dependencies],
      canvasSize: {
        width: Math.max(0, Math.round(Number(canvas?.width) || 0)),
        height: Math.max(0, Math.round(Number(canvas?.height) || 0)),
      },
      dirtyFlag: !!dirtyFlag,
    };
    const nextArtifacts = Array.isArray(exportUi.bakeArtifacts) ? [...exportUi.bakeArtifacts] : [];
    const existingIndex = nextArtifacts.findIndex((artifact) => artifact?.layerId === layerId);
    if (existingIndex >= 0) {
      nextArtifacts[existingIndex] = entry;
    } else {
      nextArtifacts.push(entry);
    }
    setExportBakeState(state, { bakeArtifacts: nextArtifacts });
    return entry;
  };

  const drawRenderPassCanvasToBakeTarget = (passName, targetCtx) => {
    const renderPassCache = runtimeState.renderPassCache && typeof runtimeState.renderPassCache === "object"
      ? runtimeState.renderPassCache
      : null;
    if (!renderPassCache || !targetCtx) return false;
    const passCanvas = renderPassCache.canvases?.[passName];
    if (!passCanvas) return false;
    const layout = renderPassCache.layouts?.[passName] || {};
    const dpr = Math.max(Number(runtimeState.dpr) || 1, 1);
    const referenceTransform = renderPassCache.referenceTransforms?.[passName] || null;
    const currentTransform = runtimeState.zoomTransform && typeof runtimeState.zoomTransform === "object"
      ? runtimeState.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const hasReferenceTransform = referenceTransform
      && Number.isFinite(Number(referenceTransform.k))
      && Number.isFinite(Number(referenceTransform.x))
      && Number.isFinite(Number(referenceTransform.y));
    const hasCurrentTransform = Number.isFinite(Number(currentTransform.k))
      && Number.isFinite(Number(currentTransform.x))
      && Number.isFinite(Number(currentTransform.y));
    if (!hasReferenceTransform || !hasCurrentTransform) {
      const offsetX = Math.round(-Number(layout.offsetX || 0) * dpr);
      const offsetY = Math.round(-Number(layout.offsetY || 0) * dpr);
      targetCtx.drawImage(passCanvas, offsetX, offsetY);
      return true;
    }
    const referenceK = Math.max(Number(referenceTransform.k) || 1, 0.0001);
    const currentK = Math.max(Number(currentTransform.k) || 1, 0.0001);
    const scaleRatio = currentK / referenceK;
    const dx = Number(currentTransform.x || 0) - (Number(referenceTransform.x || 0) * scaleRatio);
    const dy = Number(currentTransform.y || 0) - (Number(referenceTransform.y || 0) * scaleRatio);
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.translate(
      (dx - Number(layout.offsetX || 0) * scaleRatio) * dpr,
      (dy - Number(layout.offsetY || 0) * scaleRatio) * dpr,
    );
    targetCtx.scale(scaleRatio, scaleRatio);
    targetCtx.drawImage(passCanvas, 0, 0);
    targetCtx.restore();
    return true;
  };

  const bakeLayer = async (layerId, exportUiOverride = null) => {
    const exportUi = exportUiOverride && typeof exportUiOverride === "object"
      ? exportUiOverride
      : ensureExportWorkbenchUiState();
    const normalizedLayerId = String(layerId || "").trim().toLowerCase();
    if (!["color", "line", "text", "composite"].includes(normalizedLayerId)) {
      throw new Error(`Unsupported bake layer: ${layerId}`);
    }
    const width = runtimeState.colorCanvas?.width || runtimeState.lineCanvas?.width || 0;
    const height = runtimeState.colorCanvas?.height || runtimeState.lineCanvas?.height || 0;
    const dependencies = getLayerDependencyRevision(normalizedLayerId, exportUi);
    const hash = computeBakeHash([normalizedLayerId, `${width}x${height}`, ...dependencies]);
    const cacheEntry = exportBakeCache.get(normalizedLayerId);
    if (
      cacheEntry
      && cacheEntry.hash === hash
      && cacheEntry.canvas
      && cacheEntry.canvas.width === width
      && cacheEntry.canvas.height === height
    ) {
      writeBakeArtifactMeta(normalizedLayerId, dependencies, cacheEntry.canvas, false);
      return cacheEntry.canvas;
    }
    const bakeCanvas = document.createElement("canvas");
    bakeCanvas.width = width;
    bakeCanvas.height = height;
    const bakeCtx = bakeCanvas.getContext("2d");
    if (!bakeCtx) {
      throw new Error("Canvas bake context unavailable.");
    }
    const bakePassNames = getBakePassNamesForLayer(normalizedLayerId, exportUi, {
      resolvePassSequence: resolveExportPassSequence,
      renderPassNames: RENDER_PASS_NAMES,
    });
    if (normalizedLayerId === "composite") {
      const compositeCanvas = await buildCompositeSourceCanvas(exportUi);
      bakeCtx.drawImage(compositeCanvas, 0, 0);
    } else {
      if (bakePassNames.length) {
        const passCanvas = renderExportPassesToCanvas(bakePassNames);
        if (passCanvas) {
          bakeCtx.drawImage(passCanvas, 0, 0);
        }
      }
      if (normalizedLayerId === "text" && exportUi.textVisibility?.["svg-annotations"]) {
        await drawSvgLayerToCanvas(bakeCanvas, bakeCtx, {
          onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR,
        });
      }
      if (normalizedLayerId === "text" && exportUi.textVisibility?.["special-zones"]) {
        await drawSvgLayerToCanvas(bakeCanvas, bakeCtx, { onlyViewportSelector: ".special-zones-layer" });
      }
    }
    const version = cacheEntry ? Number(cacheEntry.version || 0) + 1 : 1;
    exportBakeCache.set(normalizedLayerId, {
      hash,
      version,
      canvas: bakeCanvas,
      updatedAt: Date.now(),
      dependencies,
      canvasSize: { width, height },
      dirtyFlag: true,
    });
    writeBakeArtifactMeta(normalizedLayerId, dependencies, bakeCanvas, true);
    return bakeCanvas;
  };

  const applyExportAdjustmentsToCanvas = (sourceCanvas, exportUi, { width = sourceCanvas?.width, height = sourceCanvas?.height } = {}) => {
    if (!sourceCanvas) {
      throw createExportError("invalid-params", "Missing export source canvas.");
    }
    const targetWidth = Math.max(1, Math.round(Number(width) || 0));
    const targetHeight = Math.max(1, Math.round(Number(height) || 0));
    const adjustedCanvas = document.createElement("canvas");
    adjustedCanvas.width = targetWidth;
    adjustedCanvas.height = targetHeight;
    const adjustedCtx = adjustedCanvas.getContext("2d");
    if (!adjustedCtx) {
      throw createExportError("invalid-params", "Canvas export context unavailable.");
    }
    adjustedCtx.imageSmoothingEnabled = true;
    adjustedCtx.imageSmoothingQuality = "high";
    adjustedCtx.filter = buildExportAdjustmentFilter(exportUi);
    adjustedCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
    adjustedCtx.filter = "none";
    return adjustedCanvas;
  };

  const cloneCanvas = (sourceCanvas) => {
    if (!sourceCanvas) return null;
    const canvas = document.createElement("canvas");
    canvas.width = sourceCanvas.width || 0;
    canvas.height = sourceCanvas.height || 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(sourceCanvas, 0, 0);
    return canvas;
  };

  const buildSvgAnnotationCanvas = async (options = {}) => {
    const width = runtimeState.colorCanvas?.width || runtimeState.lineCanvas?.width || 0;
    const height = runtimeState.colorCanvas?.height || runtimeState.lineCanvas?.height || 0;
    if (!(width > 0) || !(height > 0)) {
      throw createExportError("invalid-params", "SVG annotation canvas unavailable.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw createExportError("invalid-params", "SVG annotation context unavailable.");
    }
    await drawSvgLayerToCanvas(canvas, ctx, options);
    return canvas;
  };

  const buildSpecialZonesExportCanvas = async () => buildSvgAnnotationCanvas({
    onlyViewportSelector: ".special-zones-layer",
  });

  const buildCompositeSourceCanvas = async (exportUi) => {
    const passNames = resolveExportPassSequence({
      ...exportUi,
      visibility: exportUi.visibility,
    }, RENDER_PASS_NAMES).filter((passName) => exportUi.textVisibility?.["render-labels"] || passName !== "labels");
    const compositeCanvas = renderExportPassesToCanvas(passNames);
    if (!compositeCanvas) {
      throw createExportError("invalid-params", "Composite export canvas unavailable.");
    }
    const workingCanvas = cloneCanvas(compositeCanvas) || compositeCanvas;
    if (exportUi.textVisibility?.["svg-annotations"]) {
      const workingCtx = workingCanvas.getContext("2d");
      if (!workingCtx) {
        throw createExportError("invalid-params", "Composite export context unavailable.");
      }
      await drawSvgLayerToCanvas(workingCanvas, workingCtx, {
        onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR,
      });
    }
    if (exportUi.textVisibility?.["special-zones"]) {
      const workingCtx = workingCanvas.getContext("2d");
      if (!workingCtx) {
        throw createExportError("invalid-params", "Composite export context unavailable.");
      }
      await drawSvgLayerToCanvas(workingCanvas, workingCtx, { onlyViewportSelector: ".special-zones-layer" });
    }
    return workingCanvas;
  };

  const buildSingleExportSourceCanvas = async (exportUi, sourceId) => {
    const normalizedSourceId = String(sourceId || "").trim();
    if (EXPORT_MAIN_LAYER_MODEL_BY_ID.has(normalizedSourceId)) {
      const model = EXPORT_MAIN_LAYER_MODEL_BY_ID.get(normalizedSourceId);
      const canvas = renderExportPassesToCanvas(model?.passNames || []);
      if (!canvas) {
        throw createExportError("invalid-params", `Layer export canvas unavailable for ${normalizedSourceId}.`);
      }
      return canvas;
    }
    if (normalizedSourceId === "render-labels") {
      const canvas = renderExportPassesToCanvas(["labels"]);
      if (!canvas) {
        throw createExportError("invalid-params", "Render-pass label canvas unavailable.");
      }
      return canvas;
    }
    if (normalizedSourceId === "svg-annotations") {
      return buildSvgAnnotationCanvas({ onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR });
    }
    if (normalizedSourceId === "special-zones") {
      return buildSpecialZonesExportCanvas();
    }
    throw createExportError("invalid-params", `Unsupported preview source: ${normalizedSourceId}`);
  };

  const getSelectedExportScale = () => {
    const rawValue = String(exportScale?.value || ensureExportWorkbenchUiState().scale || "2").trim();
    return ["1", "1.5", "2", "4"].includes(rawValue) ? Number(rawValue) : 2;
  };

  const scaleCanvasForExport = (sourceCanvas, scaleMultiplier, exportUi) => {
    if (!sourceCanvas) {
      throw createExportError("invalid-params", "Missing export source canvas.");
    }
    const { width: baseWidth, height: baseHeight } = resolveExportBaseDimensions(
      Number(runtimeState.dpr || 0),
      Number(runtimeState.width || 0),
      Number(runtimeState.height || 0),
      Number(runtimeState.colorCanvas?.width || 0),
      Number(runtimeState.colorCanvas?.height || 0),
    );
    if (!(baseWidth > 0) || !(baseHeight > 0)) {
      throw createExportError("invalid-params", "Missing preview canvas dimensions.");
    }
    const targetWidth = Math.round(baseWidth * scaleMultiplier);
    const targetHeight = Math.round(baseHeight * scaleMultiplier);
    if (targetWidth > EXPORT_MAX_DIMENSION_PX || targetHeight > EXPORT_MAX_DIMENSION_PX) {
      throw createExportError("invalid-params", `Export size exceeds 8K cap (${targetWidth}x${targetHeight}).`);
    }
    if (targetWidth * targetHeight > EXPORT_MAX_PIXELS) {
      throw createExportError("invalid-params", `Export pixel budget exceeded (${targetWidth}x${targetHeight}).`);
    }
    return applyExportAdjustmentsToCanvas(sourceCanvas, exportUi, {
      width: targetWidth,
      height: targetHeight,
    });
  };

  const buildCompositeExportCanvas = async (exportUi, scaleMultiplier) => {
    const compositeCanvas = await buildCompositeSourceCanvas(exportUi);
    return scaleCanvasForExport(compositeCanvas, scaleMultiplier, exportUi);
  };

  const buildPerLayerExportOutputs = async (exportUi, scaleMultiplier) => {
    const outputs = buildPerLayerExportPlan(exportUi);
    for (const output of outputs) {
      const layerCanvas = await buildSingleExportSourceCanvas(exportUi, output.id);
      output.canvas = scaleCanvasForExport(layerCanvas, scaleMultiplier, exportUi);
    }
    if (!outputs.length) {
      throw createExportError("invalid-params", "No visible export layers are available for per-layer export.");
    }
    return outputs;
  };

  const buildPerLayerExportPackage = async (exportUi, scaleMultiplier) => {
    const outputs = await buildPerLayerExportOutputs(exportUi, scaleMultiplier);
    return buildExportArtifactPackage({
      artifactKind: "per-layer",
      fileStem: "map_layers",
      scenario: buildExportArtifactScenarioContext(
        String(runtimeState.activeScenarioId || ""),
        Number(runtimeState.activeScenarioManifest?.version || 1),
        String(runtimeState.scenarioBaselineHash || ""),
      ),
      project: buildExportArtifactProjectContext(
        Number(runtimeState.dirtyRevision || 0),
        Number(runtimeState.colorRevision || 0),
        Number(runtimeState.topologyRevision || 0),
      ),
      exportUi: buildExportUiManifestSnapshot(exportUi),
      files: buildPerLayerPackageFiles(outputs),
    });
  };

  const buildBakePackOutputs = async (exportUi, scaleMultiplier) => {
    const outputs = [];
    const bakeLayerIds = getBakePackLayerIds(exportUi);
    for (const layerId of bakeLayerIds) {
      const bakedCanvas = await bakeLayer(layerId, exportUi);
      outputs.push({
        id: layerId,
        canvas: scaleCanvasForExport(bakedCanvas, scaleMultiplier, exportUi),
      });
    }
    const metadata = buildBakePackMetadata(exportUi, outputs);
    outputs.push({
      id: "metadata",
      blob: new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
      extension: "json",
      fileStem: "map_bake_manifest",
    });
    return outputs;
  };

  const buildBakePackPackage = async (exportUi, scaleMultiplier) => {
    const outputs = await buildBakePackOutputs(exportUi, scaleMultiplier);
    return buildExportArtifactPackage({
      artifactKind: "bake-pack",
      fileStem: "map_bake_pack",
      scenario: buildExportArtifactScenarioContext(
        String(runtimeState.activeScenarioId || ""),
        Number(runtimeState.activeScenarioManifest?.version || 1),
        String(runtimeState.scenarioBaselineHash || ""),
      ),
      project: buildExportArtifactProjectContext(
        Number(runtimeState.dirtyRevision || 0),
        Number(runtimeState.colorRevision || 0),
        Number(runtimeState.topologyRevision || 0),
      ),
      exportUi: buildExportUiManifestSnapshot(exportUi),
      files: buildBakePackPackageFiles(outputs),
    });
  };

  const triggerCanvasDownload = (canvas, extension, fileStem) => {
    const format = extension === "jpg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(format, 0.92);
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${fileStem}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const triggerBlobDownload = (blob, extension, fileStem) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${fileStem}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const syncExportWorkbenchControlsFromState = () => {
    return exportWorkbenchController?.syncExportWorkbenchControlsFromState() || ensureExportWorkbenchUiState();
  };

  renderTextureUI();
  renderDayNightUI();


  if (toggleWaterRegions) {
    toggleWaterRegions.checked = !!runtimeState.showWaterRegions;
    toggleWaterRegions.addEventListener("change", (event) => {
      runtimeState.showWaterRegions = event.target.checked;
      if (runtimeState.showWaterRegions) {
        void ensureActiveScenarioOptionalLayerLoaded("water", { renderNow: true });
      }
      renderDirty("toggle-water-regions");
    });
  }

  if (toggleOpenOceanRegions) {
    toggleOpenOceanRegions.checked = !!runtimeState.showOpenOceanRegions;
    toggleOpenOceanRegions.addEventListener("change", (event) => {
      runtimeState.allowOpenOceanSelect = !!event.target.checked;
      runtimeState.allowOpenOceanPaint = !!event.target.checked;
      runtimeState.showOpenOceanRegions = !!event.target.checked;
      if (!runtimeState.showOpenOceanRegions) {
        runtimeState.hoveredWaterRegionId = null;
      }
      callRuntimeHook(state, "updateWaterInteractionUIFn");
      callRuntimeHook(state, "renderWaterRegionListFn");
      renderDirty("toggle-open-ocean-regions");
    });
  }

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

  if (colorModeSelect) {
    colorModeSelect.value = runtimeState.colorMode;
    colorModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "region");
      runtimeState.colorMode = value === "political" ? "political" : "region";
    });
  }

  if (paintGranularitySelect) {
    paintGranularitySelect.value = runtimeState.interactionGranularity || "subdivision";
    paintGranularitySelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "subdivision");
      const requested = value === "country" ? "country" : "subdivision";
      runtimeState.interactionGranularity =
        runtimeState.paintMode === "sovereignty" ? "subdivision" : requested;
      paintGranularitySelect.value = runtimeState.interactionGranularity;
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
      }
    });
  }

  if (paintModeSelect) {
    paintModeSelect.value = runtimeState.paintMode || "visual";
    paintModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "visual");
      runtimeState.paintMode = value === "sovereignty" ? "sovereignty" : "visual";
      if (runtimeState.paintMode === "sovereignty") {
        runtimeState.interactionGranularity = "subdivision";
        runtimeState.ui.politicalEditingExpanded = true;
        if (paintGranularitySelect) {
          paintGranularitySelect.value = "subdivision";
        }
      }
      if (typeof runtimeState.updatePaintModeUIFn === "function") {
        runtimeState.updatePaintModeUIFn();
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
      const featureIds = Object.keys(runtimeState.visualOverrides || {});
      const ownerCodes = Array.from(new Set([
        ...Object.keys(runtimeState.sovereignBaseColors || {}),
        ...Object.keys(runtimeState.countryBaseColors || {}),
      ]));
      const sovereigntyFeatureIds = String(runtimeState.paintMode || "visual") === "sovereignty"
        ? Object.keys(runtimeState.sovereigntyByFeatureId || {})
        : [];
      const before = captureHistoryState({
        featureIds,
        ownerCodes,
        sovereigntyFeatureIds,
      });
      if (runtimeState.paintMode === "sovereignty") {
        if (runtimeState.activeScenarioId) {
          resetScenarioToBaselineCommand({
            renderMode: "none",
            markDirtyReason: "",
            showToastOnComplete: false,
          });
        } else {
          resetAllFeatureOwnersToCanonical();
        }
        scheduleDynamicBorderRecompute("clear-sovereignty", 90);
      } else {
        runtimeState.colors = {};
        runtimeState.visualOverrides = {};
        runtimeState.featureOverrides = {};
        runtimeState.countryBaseColors = {};
        runtimeState.sovereignBaseColors = {};
        markLegacyColorStateDirty();
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
          affectsSovereignty: runtimeState.paintMode === "sovereignty",
        },
      });
      showToast(t("Map cleared. Undo is available from history.", "ui"), {
        title: t("Clear Map", "ui"),
        tone: "warning",
        actionLabel: t("Undo", "ui"),
        onAction: () => {
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
  applyAppearanceFilter();
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
  if (dockReferencePopover) {
    dockReferencePopover.setAttribute("aria-hidden", "true");
  }
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
