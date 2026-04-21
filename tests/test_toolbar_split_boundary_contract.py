from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
EXPORT_FAILURE_HANDLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "export_failure_handler.js"
PALETTE_LIBRARY_PANEL_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "palette_library_panel.js"
SCENARIO_GUIDE_POPOVER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "scenario_guide_popover.js"
SPECIAL_ZONE_EDITOR_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "special_zone_editor.js"
EXPORT_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "export_workbench_controller.js"
TRANSPORT_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_controller.js"
WORKSPACE_CHROME_SUPPORT_SURFACE_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "workspace_chrome_support_surface_controller.js"
APPEARANCE_CONTROLS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_controls_controller.js"
OCEAN_LAKE_CONTROLS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "ocean_lake_controls_controller.js"
UI_SURFACE_URL_STATE_JS = REPO_ROOT / "js" / "ui" / "ui_surface_url_state.js"
FILE_MANAGER_JS = REPO_ROOT / "js" / "core" / "file_manager.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"


class ToolbarSplitBoundaryContractTest(unittest.TestCase):
    def test_toolbar_imports_new_split_modules(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('./toolbar/export_failure_handler.js', content)
        self.assertIn('./toolbar/palette_library_panel.js', content)
        self.assertIn("createExportError,", content)
        self.assertIn("showExportFailureToast,", content)
        self.assertIn("createPaletteLibraryPanelController", content)
        self.assertIn('./toolbar/scenario_guide_popover.js', content)
        self.assertIn("createScenarioGuidePopoverController", content)
        self.assertIn('./toolbar/export_workbench_controller.js', content)
        self.assertIn("createExportWorkbenchController", content)
        self.assertIn('./toolbar/transport_workbench_controller.js', content)
        self.assertIn("createTransportWorkbenchController", content)
        self.assertIn('./toolbar/workspace_chrome_support_surface_controller.js', content)
        self.assertIn("createWorkspaceChromeSupportSurfaceController", content)
        self.assertIn('./ui_surface_url_state.js', content)
        self.assertIn("createUiSurfaceUrlState", content)
        self.assertIn('./toolbar/appearance_controls_controller.js', content)
        self.assertIn("createAppearanceControlsController", content)
        self.assertIn('./toolbar/ocean_lake_controls_controller.js', content)
        self.assertIn("createOceanLakeControlsController", content)

    def test_export_failure_owner_moves_out_of_toolbar(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = EXPORT_FAILURE_HANDLER_JS.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r"^function\s+createExportError\b", toolbar_content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+classifyExportFailure\b", toolbar_content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+showExportFailureToast\b", toolbar_content, re.MULTILINE))
        self.assertIn("function createExportError", owner_content)
        self.assertIn("function classifyExportFailure", owner_content)
        self.assertIn("function showExportFailureToast", owner_content)

    def test_palette_library_owner_moves_to_panel_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = PALETTE_LIBRARY_PANEL_JS.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r"^(async\s+)?function\s+handlePaletteSourceChange\b", toolbar_content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+renderPaletteLibrary\b", toolbar_content, re.MULTILINE))
        self.assertNotIn("ensurePaletteLibrarySectionState =", toolbar_content)
        self.assertNotIn("buildPaletteLibraryGroups =", toolbar_content)
        self.assertIn("function createPaletteLibraryPanelController", owner_content)
        self.assertIn("function renderPaletteLibrary()", owner_content)
        self.assertIn("async function handlePaletteSourceChange", owner_content)
        self.assertIn("const ensurePaletteLibrarySectionState =", owner_content)
        self.assertIn("const buildPaletteLibraryGroups =", owner_content)

    def test_toolbar_keeps_palette_callbacks_and_render_entry(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "updatePaletteSourceUIFn", syncPaletteSourceControls);', content)
        self.assertIn('registerRuntimeHook(state, "updatePaletteLibraryUIFn", renderPaletteLibrary);', content)
        self.assertIn('registerRuntimeHook(state, "renderPaletteFn", renderPalette);', content)
        self.assertIn("bindPaletteLibraryPanelEvents();", content)
        self.assertIn("syncPaletteLibraryPanelVisibility();", content)

    def test_toolbar_keeps_export_failure_handler_call_sites(self):
        owner_content = EXPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertGreaterEqual(owner_content.count("showExportFailureToast(error);"), 2)

    def test_export_workbench_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = EXPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("function createExportWorkbenchController", owner_content)
        self.assertIn("function ensureExportWorkbenchUiState", owner_content)
        self.assertIn("function resolveExportPassSequence", owner_content)
        self.assertIn("const renderExportWorkbenchPreview = async () => {", owner_content)
        self.assertIn("const renderExportWorkbenchUi = (isOpen) => {", owner_content)
        self.assertIn("const bindExportWorkbenchEvents = () => {", owner_content)
        self.assertIn("return exportWorkbenchController?.renderExportWorkbenchPreview();", toolbar_content)
        self.assertIn("return exportWorkbenchController?.renderExportWorkbenchBakeArtifactList();", toolbar_content)
        self.assertIn("return exportWorkbenchController?.syncExportPreviewSourceOptions();", toolbar_content)
        self.assertIn('id: "background"', owner_content)
        self.assertIn('id: "political"', owner_content)
        self.assertIn('id: "context"', owner_content)
        self.assertIn('id: "effects"', owner_content)
        self.assertIn('id: "labels"', owner_content)
        self.assertIn('passNames: ["background"]', owner_content)
        self.assertIn('passNames: ["physicalBase", "political"]', owner_content)
        self.assertIn('passNames: ["contextBase", "contextScenario"]', owner_content)
        self.assertIn('passNames: ["effects", "lineEffects", "contextMarkers", "dayNight", "borders", "textureLabels"]', owner_content)

    def test_export_pipeline_relies_on_controller_pass_flow(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertNotIn("const drawLineLayerToCanvas = (targetCtx) => {", toolbar_content)
        self.assertNotIn("const drawColorLayerToCanvas = (targetCtx) => {", toolbar_content)
        self.assertNotIn("const drawCompositeLayerToCanvas = (targetCtx) => {", toolbar_content)
        self.assertIn("const bakePassNames = getBakePassNamesForLayer(normalizedLayerId, exportUi);", toolbar_content)
        self.assertIn("const compositeCanvas = await buildCompositeSourceCanvas(exportUi);", toolbar_content)
        self.assertIn("const passCanvas = renderExportPassesToCanvas(bakePassNames);", toolbar_content)

    def test_toolbar_keeps_export_workbench_facade_and_url_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "openExportWorkbenchFn", (trigger = dockExportBtn) => {', content)
        self.assertIn('registerRuntimeHook(state, "closeExportWorkbenchFn", ({ restoreFocus = true } = {}) => {', content)
        self.assertIn("closeDockPopover({ restoreFocus: false, syncUrl: false });", content)
        self.assertIn("closeScenarioGuidePopover({ restoreFocus: false, syncUrl: false });", content)
        self.assertIn("exportProjectSection.open = true;", content)
        self.assertIn('syncSupportSurfaceUrlState("export")', content)
        self.assertIn('syncSupportSurfaceUrlState("")', content)

    def test_scenario_guide_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = SCENARIO_GUIDE_POPOVER_JS.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r"^const\s+renderScenarioGuideSection\s*=", toolbar_content, re.MULTILINE))
        self.assertIsNone(re.search(r"^const\s+focusScenarioGuideSectionButton\s*=", toolbar_content, re.MULTILINE))
        self.assertIsNone(re.search(r"^const\s+renderScenarioGuideStatus\s*=", toolbar_content, re.MULTILINE))
        self.assertIn("function createScenarioGuidePopoverController", owner_content)
        self.assertIn("const renderScenarioGuideSection =", owner_content)
        self.assertIn("const focusScenarioGuideSectionButton =", owner_content)
        self.assertIn("const renderScenarioGuideStatus =", owner_content)
        self.assertIn("const syncScenarioGuideTriggerButtons =", owner_content)
        self.assertIn("const openScenarioGuideSurface =", owner_content)
        self.assertIn("const closeScenarioGuideSurface =", owner_content)
        self.assertIn("const bindScenarioGuideEvents =", owner_content)

    def test_toolbar_keeps_scenario_guide_facade_and_url_restore_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        support_owner = WORKSPACE_CHROME_SUPPORT_SURFACE_CONTROLLER_JS.read_text(encoding="utf-8")
        url_owner = UI_SURFACE_URL_STATE_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "restoreSupportSurfaceFromUrlFn", restoreSupportSurfaceFromUrl);', content)
        self.assertIn("const uiSurfaceUrlState = createUiSurfaceUrlState({", content)
        self.assertIn("getScenarioGuideSectionFromUrl,", content)
        self.assertIn("syncScenarioGuideSectionUrlState,", content)
        self.assertIn("getSupportSurfaceViewFromUrl,", content)
        self.assertIn("syncSupportSurfaceUrlState,", content)
        self.assertIn('syncSupportSurfaceUrlState("guide")', support_owner)
        self.assertIn("getScenarioGuideSectionFromUrl", url_owner)
        self.assertIn("syncScenarioGuideSectionUrlState", url_owner)
        self.assertIn("bindScenarioGuideEvents({", content)
        self.assertIn("toggleScenarioGuidePopover(trigger);", content)
        self.assertIn('closeScenarioGuidePopover({ restoreFocus: true });', content)

    def test_special_zone_editor_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = SPECIAL_ZONE_EDITOR_JS.read_text(encoding="utf-8")

        self.assertIn('./toolbar/special_zone_editor.js', toolbar_content)
        self.assertIn("createSpecialZoneEditorController", toolbar_content)
        self.assertIsNone(re.search(r"^const\s+onSpecialZonesStyleChange\s*=", toolbar_content, re.MULTILINE))
        self.assertNotIn("specialZoneStartBtn.addEventListener", toolbar_content)
        self.assertNotIn("specialZoneDeleteBtn.addEventListener", toolbar_content)
        self.assertIn("function createSpecialZoneEditorController", owner_content)
        self.assertIn("const onSpecialZonesStyleChange =", owner_content)
        self.assertIn("const renderSpecialZoneEditorUI =", owner_content)
        self.assertIn("const bindSpecialZoneEditorEvents =", owner_content)
        self.assertIn("startSpecialZoneDraw({", owner_content)
        self.assertIn("deleteSelectedManualSpecialZone();", owner_content)

    def test_toolbar_keeps_special_zone_facade_and_callback_registration(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        appearance_owner = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);', content)
        self.assertIn("specialZoneEditorController.normalizeSpecialZoneEditorState();", content)
        self.assertIn("specialZoneEditorController.bindSpecialZoneEditorEvents();", content)
        self.assertIn("const openSpecialZonePopover = () => {", content)
        self.assertIn("openSpecialZonePopover();", appearance_owner)
        self.assertIn('appearanceSpecialZoneBtn.setAttribute("aria-controls", "specialZonePopover");', appearance_owner)

    def test_special_zone_persistence_contract_stays_stable(self):
        file_manager = FILE_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")

        self.assertIn("specialZones: appState.specialZones || {}", file_manager)
        self.assertIn('manualSpecialZones: appState.manualSpecialZones || { type: "FeatureCollection", features: [] }', file_manager)
        self.assertIn("specialZones: appState.styleConfig?.specialZones || null", file_manager)
        self.assertIn("state.specialZones = data.specialZones || {}", interaction_funnel)
        self.assertIn("state.manualSpecialZones =", interaction_funnel)
        self.assertIn("state.styleConfig.specialZones = {", interaction_funnel)

    def test_export_workbench_persistence_contract_stays_stable(self):
        file_manager = FILE_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")

        self.assertIn("exportWorkbenchUi: normalizeExportWorkbenchUiState(appState.exportWorkbenchUi)", file_manager)
        self.assertIn("data.exportWorkbenchUi = normalizeExportWorkbenchUiState(data.exportWorkbenchUi);", file_manager)
        self.assertIn("state.exportWorkbenchUi = normalizeExportWorkbenchUiState({", interaction_funnel)
        self.assertIn("...(data.exportWorkbenchUi.visibility || data.exportWorkbenchUi.layerVisibility || {})", interaction_funnel)

    def test_transport_workbench_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createTransportWorkbenchController", owner_content)
        self.assertIn("const renderTransportWorkbenchUi = () => {", owner_content)
        self.assertIn("const bindTransportWorkbenchEvents = () => {", owner_content)
        self.assertIn("const initializeTransportWorkbenchRuntime = () => {", owner_content)
        self.assertIn("const openTransportWorkbench = (trigger = null) => {", owner_content)
        self.assertIn("const closeTransportWorkbench = ({ restoreFocus = true } = {}) => {", owner_content)
        self.assertNotIn("function normalizeTransportWorkbenchFamily", toolbar_content)
        self.assertNotIn("function normalizeTransportWorkbenchInspectorTab", toolbar_content)
        self.assertNotIn("function normalizeRoadTransportWorkbenchConfig", toolbar_content)
        self.assertNotIn("function ensureTransportWorkbenchUiState", toolbar_content)

    def test_toolbar_keeps_transport_workbench_facade_and_surface_coordination_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        support_owner = WORKSPACE_CHROME_SUPPORT_SURFACE_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "openTransportWorkbenchFn", (trigger = null) => openTransportWorkbench(trigger));', content)
        self.assertIn('registerRuntimeHook(state, "closeTransportWorkbenchFn", ({ restoreFocus = true } = {}) => (', content)
        self.assertIn("closeTransportWorkbench({ restoreFocus })", content)
        self.assertIn('registerRuntimeHook(state, "refreshTransportWorkbenchUiFn", renderTransportWorkbenchUi);', content)
        self.assertIn("initializeTransportWorkbenchRuntime();", content)
        self.assertIn("state.ui?.restoredSupportSurfaceViewFromUrl === view", support_owner)
        self.assertIn('["guide", "reference", "export"].includes(view)', support_owner)
        self.assertIn("document.body.classList.contains(\"left-drawer-open\")", TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8"))
        self.assertIn("state.closeDockPopoverFn?.({ restoreFocus: false });", TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8"))
        self.assertIn("state.closeExportWorkbenchFn?.({ restoreFocus: false });", TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8"))

    def test_appearance_controller_owns_transport_appearance_and_shell_logic(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createAppearanceControlsController", owner_content)
        self.assertIn("const applyAppearanceFilter = () => {", owner_content)
        self.assertIn("const setAppearanceTab = (tabId = \"ocean\") => {", owner_content)
        self.assertIn("const getTransportAppearanceConfig = () => {", owner_content)
        self.assertIn("const renderTransportAppearanceUi = () => {", owner_content)
        self.assertIn("const renderRecentColors = () => {", owner_content)
        self.assertIn("const renderParentBorderCountryList = () => {", owner_content)
        self.assertIn("const bindEvents = () => {", owner_content)
        self.assertNotIn("const getTransportAppearanceConfig = () => {", toolbar_content)
        self.assertNotIn("const applyAppearanceFilter = () => {", toolbar_content)
        self.assertNotIn("function renderRecentColors()", toolbar_content)
        self.assertNotIn("function renderParentBorderCountryList()", toolbar_content)

    def test_toolbar_keeps_appearance_facade_and_state_registration_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "updateTransportAppearanceUIFn", renderTransportAppearanceUi);', content)
        self.assertIn('registerRuntimeHook(state, "updateRecentUI", () => {', content)
        self.assertIn('registerRuntimeHook(state, "updateParentBorderCountryListFn", renderParentBorderCountryList);', content)
        self.assertIn("bindAppearanceControlEvents();", content)
        self.assertIn("setAppearanceTab(\"ocean\");", content)
        self.assertIn("applyAppearanceFilter();", content)

    def test_appearance_controller_owns_texture_and_day_night_logic(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("const syncDayNightConfig = () => {", owner_content)
        self.assertIn("const renderTextureModePanels = (mode = state.styleConfig.texture?.mode || \"none\") => {", owner_content)
        self.assertIn("const renderTextureUI = () => {", owner_content)
        self.assertIn("const renderDayNightUI = () => {", owner_content)
        self.assertIn("const updateTextureStyle = (mutate, { historyKind = \"texture-style\", commitHistory = false } = {}) => {", owner_content)
        self.assertIn("const bindTextureRange = (element, handler) => {", owner_content)
        self.assertIn("const bindTextureColorInput = (element, handler) => {", owner_content)
        self.assertNotIn("const syncDayNightConfig = () => {", toolbar_content)
        self.assertNotIn("const renderTextureUI = () => {", toolbar_content)
        self.assertNotIn("const renderDayNightUI = () => {", toolbar_content)
        self.assertNotIn("const updateTextureStyle = (mutate, { historyKind = \"texture-style\", commitHistory = false } = {}) => {", toolbar_content)
        self.assertNotIn("const bindTextureRange = (element, handler) => {", toolbar_content)
        self.assertNotIn("const bindTextureColorInput = (element, handler) => {", toolbar_content)

    def test_toolbar_keeps_texture_facade_and_refresh_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "updateTextureUIFn", renderTextureUI);', content)
        self.assertIn("renderTextureUI();", content)
        self.assertIn("renderDayNightUI();", content)
        self.assertIn('registerRuntimeHook(state, "updateToolbarInputsFn", () => {', content)

    def test_appearance_controller_owns_city_urban_physical_rivers_logic(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("const syncCityPointsConfig = () => {", owner_content)
        self.assertIn("const syncPhysicalConfig = () => {", owner_content)
        self.assertIn("const renderAppearanceStyleControlsUi = () => {", owner_content)
        self.assertIn("toggleUrban.addEventListener(\"change\", (event) => {", owner_content)
        self.assertIn("physicalPreset.addEventListener(\"change\", (event) => {", owner_content)
        self.assertIn("riversDashStyle.addEventListener(\"change\", (event) => {", owner_content)
        self.assertNotIn("const syncCityPointsConfig = () => {", toolbar_content)
        self.assertNotIn("const syncPhysicalConfig = () => {", toolbar_content)
        self.assertNotIn("toggleUrban.addEventListener(\"change\", (event) => {", toolbar_content)
        self.assertNotIn("physicalPreset.addEventListener(\"change\", (event) => {", toolbar_content)
        self.assertNotIn("riversDashStyle.addEventListener(\"change\", (event) => {", toolbar_content)

    def test_toolbar_keeps_city_urban_physical_special_zone_facade_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn("function renderSpecialZoneEditorUI() {", content)
        self.assertIn("renderAppearanceStyleControlsUi();", content)
        self.assertIn("specialZoneEditorController.renderSpecialZoneEditorUI();", content)
        self.assertIn('registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);', content)

    def test_appearance_controller_owns_reference_overlay_logic(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("const renderReferenceOverlayUi = () => {", owner_content)
        self.assertIn("referenceImageInput.addEventListener(\"change\", (event) => {", owner_content)
        self.assertIn("markDirty(\"reference-image-file\");", owner_content)
        self.assertIn("markDirty(\"reference-offset-y\");", owner_content)
        self.assertNotIn("const applyReferenceStyles = () => {", toolbar_content)
        self.assertNotIn("referenceImageInput.addEventListener(\"change\", (event) => {", toolbar_content)

    def test_toolbar_keeps_reference_refresh_facade_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn("renderReferenceOverlayUi();", content)
        self.assertIn('registerRuntimeHook(state, "updateToolbarInputsFn", () => {', content)

    def test_ocean_lake_controller_owns_water_appearance_logic(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = OCEAN_LAKE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createOceanLakeControlsController", owner_content)
        self.assertIn("const beginLakeHistoryCapture = () => {", owner_content)
        self.assertIn("const commitLakeHistory = (kind = \"lake-style\") => {", owner_content)
        self.assertIn("const renderOceanLakeControlsUi = () => {", owner_content)
        self.assertIn("const renderOceanCoastalAccentUi = () => {", owner_content)
        self.assertIn("const applyAutoFillOceanColor = () => {", owner_content)
        self.assertIn("const bindOceanVisualInput = (element, onInput, onChange = null) => {", owner_content)
        self.assertNotIn("let lakeHistoryBefore = null;", toolbar_content)
        self.assertNotIn("const beginLakeHistoryCapture = () => {", toolbar_content)
        self.assertNotIn("const commitLakeHistory = (kind = \"lake-style\") => {", toolbar_content)
        self.assertNotIn("const bindOceanVisualInput = (element, onInput, onChange = null) => {", toolbar_content)

    def test_toolbar_keeps_ocean_lake_facade_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn("bindEvents: bindOceanLakeControlEvents,", content)
        self.assertIn("renderOceanCoastalAccentUi,", content)
        self.assertIn("renderOceanLakeControlsUi,", content)
        self.assertIn("applyAutoFillOceanColor,", content)
        self.assertIn("renderOceanCoastalAccentUi();", content)
        self.assertIn("renderOceanLakeControlsUi();", content)
        self.assertIn("bindOceanLakeControlEvents();", content)
        self.assertIn("const nextOceanFill = applyAutoFillOceanColor();", content)

    def test_workspace_chrome_support_surface_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = WORKSPACE_CHROME_SUPPORT_SURFACE_CONTROLLER_JS.read_text(encoding="utf-8")
        url_owner = UI_SURFACE_URL_STATE_JS.read_text(encoding="utf-8")

        self.assertIn("export function createWorkspaceChromeSupportSurfaceController", owner_content)
        self.assertIn("const restoreSupportSurfaceFromUrl = () => {", owner_content)
        self.assertIn("const closeDockPopover = ({ restoreFocus = false, syncUrl = true } = {}) => {", owner_content)
        self.assertIn("const openDockPopover = (kind) => {", owner_content)
        self.assertIn("const bindDockPopoverDismiss = () => {", owner_content)
        self.assertIn("export function createUiSurfaceUrlState({", url_owner)
        self.assertIn("const syncSupportSurfaceUrlState = (view = \"\") => {", url_owner)
        self.assertIn("const getSupportSurfaceViewFromUrl = () => {", url_owner)
        self.assertNotIn("const syncSupportSurfaceUrlState = (view = \"\") => {", owner_content)
        self.assertNotIn("const getScenarioGuideSectionFromUrl = () => {", toolbar_content)
        self.assertNotIn("const syncScenarioGuideSectionUrlState = (section = \"quick\") => {", toolbar_content)
        self.assertNotIn("const restoreSupportSurfaceFromUrl = () => {", toolbar_content)
        self.assertNotIn("const closeDockPopover = ({ restoreFocus = false, syncUrl = true } = {}) => {", toolbar_content)
        self.assertNotIn("const openDockPopover = (kind) => {", toolbar_content)
        self.assertNotIn("const bindDockPopoverDismiss = () => {", toolbar_content)

    def test_toolbar_keeps_support_surface_facade_and_registration_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "restoreSupportSurfaceFromUrlFn", restoreSupportSurfaceFromUrl);', content)
        self.assertIn('registerRuntimeHook(state, "closeDockPopoverFn", closeDockPopover);', content)
        self.assertIn("bindDockPopoverDismiss();", content)
        self.assertIn("restoreSupportSurfaceFromUrl();", content)
        self.assertIn("bindScenarioGuideEvents({", content)
        self.assertIn("toggleScenarioGuidePopover(trigger);", content)


if __name__ == "__main__":
    unittest.main()
