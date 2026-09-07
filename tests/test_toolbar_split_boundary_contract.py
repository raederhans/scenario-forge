import json
from pathlib import Path
import re
import unittest

from tools.pages_artifact_root import resolve_pages_artifact_root

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
DIST_TOOLBAR_JS = PAGES_DIST_ROOT / "app" / "js" / "ui" / "toolbar.js"
INDEX_HTML = REPO_ROOT / "index.html"
EXPORT_FAILURE_HANDLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "export_failure_handler.js"
EXPORT_ARTIFACT_MODEL_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "export_artifact_model.js"
PALETTE_LIBRARY_PANEL_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "palette_library_panel.js"
SCENARIO_CONTEXT_BAR_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "scenario_context_bar_controller.js"
SCENARIO_GUIDE_POPOVER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "scenario_guide_popover.js"
SCENARIO_CONTROLS_JS = REPO_ROOT / "js" / "ui" / "scenario_controls.js"
HGO_RUNTIME_PREVIEW_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "hgo_runtime_preview_controller.js"
SPECIAL_ZONE_EDITOR_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "special_zone_editor.js"
SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "special_zones_workbench_controller.js"
STYLE_CSS = REPO_ROOT / "css" / "style.css"
EXPORT_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "export_workbench_controller.js"
TRANSPORT_WORKBENCH_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_controller.js"
TRANSPORT_WORKBENCH_STATE_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_state_owner.js"
TRANSPORT_WORKBENCH_CONFIG_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_config_owner.js"
TRANSPORT_WORKBENCH_APPLY_BRIDGE_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_apply_bridge_owner.js"
TRANSPORT_WORKBENCH_PREVIEW_LIFECYCLE_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_preview_lifecycle_owner.js"
TRANSPORT_WORKBENCH_INSPECTOR_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_inspector_owner.js"
TRANSPORT_WORKBENCH_LAYER_ORDER_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_layer_order_owner.js"
TRANSPORT_WORKBENCH_LENS_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_lens_owner.js"
TRANSPORT_WORKBENCH_POPOVER_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_popover_owner.js"
TRANSPORT_WORKBENCH_RIGHT_DECK_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_right_deck_owner.js"
TRANSPORT_WORKBENCH_SHELL_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_shell_owner.js"
TRANSPORT_WORKBENCH_EVENT_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_event_owner.js"
TRANSPORT_WORKBENCH_CARRIER_JS = REPO_ROOT / "js" / "ui" / "transport_workbench_carrier.js"
WORKSPACE_CHROME_SUPPORT_SURFACE_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "workspace_chrome_support_surface_controller.js"
APPEARANCE_CONTROLS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_controls_controller.js"
LAYER_PANEL_CONTRACTS_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "layer_panel_contracts.js"
LAYER_STATUS_DIAGNOSTICS_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "layer_status_diagnostics.js"
THEMATIC_LAYER_CATALOG_JS = REPO_ROOT / "js" / "core" / "thematic_layer_catalog.js"
THEMATIC_LAYER_PREVIEW_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "thematic_layer_preview_controller.js"
TRANSPORT_APPEARANCE_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "transport_appearance_controller.js"
APPEARANCE_CITY_POINTS_DESCRIPTOR_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_city_points_descriptor.js"
APPEARANCE_CITY_POINTS_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_city_points_owner.js"
APPEARANCE_PARENT_BORDER_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_parent_border_owner.js"
APPEARANCE_PHYSICAL_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_physical_owner.js"
APPEARANCE_REFERENCE_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_reference_owner.js"
APPEARANCE_RIVERS_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_rivers_owner.js"
APPEARANCE_TEXTURE_OWNER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_texture_owner.js"
OCEAN_LAKE_CONTROLS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "ocean_lake_controls_controller.js"
UI_SURFACE_URL_STATE_JS = REPO_ROOT / "js" / "ui" / "ui_surface_url_state.js"
FILE_MANAGER_JS = REPO_ROOT / "js" / "core" / "file_manager.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
I18N_CATALOG_JS = REPO_ROOT / "js" / "core" / "i18n_catalog.js"
LOCALES_JSON = REPO_ROOT / "data" / "locales.json"

TOOLBAR_SHELL_MAX_LINES = 3100
SCENARIO_CONTEXT_BAR_CONTROLLER_MAX_LINES = 240


class ToolbarSplitBoundaryContractTest(unittest.TestCase):
    def _controller_call_body(self, content: str, factory_name: str) -> str:
        match = re.search(rf"{factory_name}\(\{{(?P<body>[\s\S]*?)\n\s*\}}\);", content)
        self.assertIsNotNone(match, f"{factory_name} call not found")
        return match.group("body")

    def _arrow_function_body(self, content: str, function_name: str) -> str:
        match = re.search(rf"const {re.escape(function_name)} = [^\n]*=> \{{(?P<body>[\s\S]*?)\n  \}};", content)
        self.assertIsNotNone(match, f"{function_name} function body not found")
        return match.group("body")

    def _event_listener_body(self, content: str, selector: str, event_name: str) -> str:
        match = re.search(
            rf"{re.escape(selector)}\.addEventListener\(\"{re.escape(event_name)}\", async \(\) => \{{(?P<body>[\s\S]*?)\n\s*\}}\);",
            content,
        )
        self.assertIsNotNone(match, f"{selector} {event_name} listener body not found")
        return match.group("body")

    def _assert_workspace_refresh_hooks_wait_for_ocean_lake_facade(self, content: str) -> None:
        controller_start = content.index("const oceanLakeControlsController = createOceanLakeControlsController({")
        facade_ready = content.index("renderOceanLakeControlsUi();", controller_start)

        for hook_name in [
            "updateWorkspaceStatusFn",
            "updateScenarioContextBarFn",
            "updateActiveSovereignUIFn",
            "updatePaintModeUIFn",
        ]:
            registration = content.index(f'registerRuntimeHook(state, "{hook_name}"', facade_ready)
            self.assertGreater(registration, facade_ready, hook_name)

        early_registration_region = content[:facade_ready]
        self.assertNotIn('registerRuntimeHook(state, "updateWorkspaceStatusFn"', early_registration_region)
        self.assertNotIn('registerRuntimeHook(state, "updateScenarioContextBarFn"', early_registration_region)
        self.assertNotIn('registerRuntimeHook(state, "updateActiveSovereignUIFn"', early_registration_region)
        self.assertNotIn('registerRuntimeHook(state, "updatePaintModeUIFn"', early_registration_region)

    def test_toolbar_shell_and_scenario_context_owner_stay_inside_module_budget(self):
        toolbar_lines = TOOLBAR_JS.read_text(encoding="utf-8").splitlines()
        scenario_context_owner_lines = SCENARIO_CONTEXT_BAR_CONTROLLER_JS.read_text(encoding="utf-8").splitlines()

        self.assertLessEqual(
            len(toolbar_lines),
            TOOLBAR_SHELL_MAX_LINES,
            "toolbar.js should stay a composition shell; move growing UI behavior into focused owners",
        )
        self.assertLessEqual(
            len(scenario_context_owner_lines),
            SCENARIO_CONTEXT_BAR_CONTROLLER_MAX_LINES,
            "scenario context bar owner should stay focused on workspace chrome",
        )

    def test_toolbar_imports_new_split_modules(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('./toolbar/export_failure_handler.js', content)
        self.assertIn('./toolbar/export_artifact_model.js', content)
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
        self.assertIn('./toolbar/hgo_runtime_preview_controller.js', content)
        self.assertIn("createHgoRuntimePreviewToolbarController", content)
        self.assertIn('./ui_surface_url_state.js', content)
        self.assertIn("createUiSurfaceUrlState", content)
        self.assertIn('./toolbar/appearance_controls_controller.js', content)
        self.assertIn("createAppearanceControlsController", content)
        self.assertIn('./toolbar/ocean_lake_controls_controller.js', content)
        self.assertIn("createOceanLakeControlsController", content)
        self.assertIn('./toolbar/scenario_context_bar_controller.js', content)
        self.assertIn("createScenarioContextBarController", content)

    def test_export_artifact_model_owns_pure_projection_helpers(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        model_content = EXPORT_ARTIFACT_MODEL_JS.read_text(encoding="utf-8")

        for helper_name in [
            "resolveExportBaseDimensions",
            "buildExportAdjustmentFilter",
            "getBakePassNamesForLayer",
            "getBakePackLayerIds",
            "buildExportArtifactScenarioContext",
            "buildExportArtifactProjectContext",
            "buildExportUiManifestSnapshot",
            "buildPerLayerExportPlan",
            "buildBakePackMetadata",
        ]:
            self.assertIn(f"export function {helper_name}", model_content)
            self.assertNotIn(f"const {helper_name} =", toolbar_content)

        self.assertNotIn("document.", model_content)
        self.assertNotIn("runtimeState", model_content)

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
        self.assertIn("function buildPaletteLibraryGroups(", owner_content)

    def test_palette_library_roving_focus_ignores_collapsed_section_rows(self):
        owner_content = PALETTE_LIBRARY_PANEL_JS.read_text(encoding="utf-8")

        self.assertIn("function isPaletteLibraryRowVisible(row)", owner_content)
        self.assertIn('querySelectorAll(".palette-library-row, .palette-library-variant-btn")', owner_content)
        self.assertIn(".filter(isPaletteLibraryRowVisible);", owner_content)
        self.assertRegex(
            owner_content,
            r"section\.addEventListener\(\"toggle\"[\s\S]*?syncPaletteLibraryRowFocus\(\);",
        )

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
        self.assertIn(
            'throw new Error("Export workbench controller is not initialized.");',
            toolbar_content,
        )
        self.assertIn("setExportBakeArtifacts: (bakeArtifacts) => setExportBakeState(state, { bakeArtifacts }),", owner_content)
        self.assertIn('import { setExportBakeState } from "../core/state/actions/export_workbench_actions.js";', toolbar_content)
        self.assertIn("setExportBakeState(state, { bakeArtifacts: nextArtifacts });", toolbar_content)
        self.assertNotIn("exportUi.bakeArtifacts = nextArtifacts;", toolbar_content)
        self.assertIn("clearBakeCache: clearExportBakeCache,", toolbar_content)
        self.assertIn('registerRuntimeHook(state, "clearExportBakeCacheFn", clearExportBakeCache);', toolbar_content)
        self.assertNotIn("ensureExportWorkbenchUiStateFromController", toolbar_content)
        controller_assignment = toolbar_content.index(
            "ensureExportWorkbenchUiState = exportWorkbenchController.ensureExportWorkbenchUiState;"
        )
        self.assertLess(
            toolbar_content.index("exportWorkbenchController = createExportWorkbenchController({"),
            controller_assignment,
        )
        self.assertLess(
            controller_assignment,
            toolbar_content.index("    syncExportWorkbenchControlsFromState();"),
        )
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
        model_content = EXPORT_ARTIFACT_MODEL_JS.read_text(encoding="utf-8")

        self.assertNotIn("const drawLineLayerToCanvas = (targetCtx) => {", toolbar_content)
        self.assertNotIn("const drawColorLayerToCanvas = (targetCtx) => {", toolbar_content)
        self.assertNotIn("const drawCompositeLayerToCanvas = (targetCtx) => {", toolbar_content)
        self.assertIn("const bakePassNames = getBakePassNamesForLayer(normalizedLayerId, exportUi, {", toolbar_content)
        self.assertIn("resolvePassSequence: resolveExportPassSequence,", toolbar_content)
        self.assertIn("renderPassNames: RENDER_PASS_NAMES,", toolbar_content)
        self.assertIn("const compositeCanvas = await buildCompositeSourceCanvas(exportUi);", toolbar_content)
        self.assertIn("const passCanvas = renderExportPassesToCanvas(bakePassNames);", toolbar_content)
        self.assertEqual(toolbar_content.count("}, RENDER_PASS_NAMES).filter((passName) =>"), 1)
        self.assertEqual(model_content.count("}, renderPassNames).filter((passName) =>"), 1)

    def test_svg_annotation_export_uses_strategic_annotation_layers_only(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn("const SVG_ANNOTATION_VIEWPORT_SELECTOR = [", toolbar_content)
        for selector in [
            ".frontline-overlay-layer",
            ".frontline-labels-layer",
            ".operational-lines-layer",
            ".operation-graphics-layer",
            ".unit-counters-layer",
        ]:
            self.assertIn(selector, toolbar_content)
        self.assertIn("onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR", toolbar_content)
        self.assertNotIn('buildSvgAnnotationCanvas({ removeSelectors: [".special-zones-layer"] })', toolbar_content)

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

    def test_scenario_context_bar_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = SCENARIO_CONTEXT_BAR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertNotIn("const SCENARIO_BAR_LEFT_OFFSET", toolbar_content)
        self.assertNotIn("const refreshScenarioSelectionChip = () => {", toolbar_content)
        self.assertNotIn("const applyScenarioOverlaySafeLayout = () => {", toolbar_content)
        self.assertNotIn("const refreshScenarioContextBar = () => {", toolbar_content)
        self.assertNotIn("const triggerScenarioGuide = () => {", toolbar_content)
        self.assertNotIn('scenarioContextCollapseBtn.addEventListener("click"', toolbar_content)
        self.assertIn("function createScenarioContextBarController", owner_content)
        self.assertIn("const refreshScenarioSelectionChip = () => {", owner_content)
        self.assertIn("const refreshWorkspaceStatus = () => {", owner_content)
        self.assertIn("const applyScenarioOverlaySafeLayout = () => {", owner_content)
        self.assertIn("const refreshScenarioContextBar = () => {", owner_content)
        self.assertIn("const triggerScenarioGuide = () => {", owner_content)
        self.assertIn("const bindScenarioContextBarEvents = () => {", owner_content)
        self.assertIn("const bindResponsiveChromeLayout = () => {", owner_content)
        self.assertIn('const scenarioViewLabel = String(runtimeState.scenarioViewMode || "ownership") === "frontline"', owner_content)
        self.assertIn("${scenarioViewLabel}", owner_content)
        self.assertIn("refreshWorkspaceStatus();", owner_content)
        self.assertIn("bindScenarioContextBarEvents();", toolbar_content)
        self.assertIn("bindResponsiveChromeLayout();", toolbar_content)
        self.assertIn('registerRuntimeHook(state, "updateWorkspaceStatusFn", refreshWorkspaceStatus);', toolbar_content)
        self.assertIn('registerRuntimeHook(state, "updateScenarioContextBarFn", refreshScenarioContextBar);', toolbar_content)

    def test_special_zone_editor_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = SPECIAL_ZONE_EDITOR_JS.read_text(encoding="utf-8")
        index_html = INDEX_HTML.read_text(encoding="utf-8")

        self.assertIn('./toolbar/special_zone_editor.js', toolbar_content)
        self.assertIn("createSpecialZoneEditorController", toolbar_content)
        self.assertIsNone(re.search(r"^const\s+onSpecialZonesStyleChange\s*=", toolbar_content, re.MULTILINE))
        self.assertNotIn("specialZoneStartBtn.addEventListener", toolbar_content)
        self.assertNotIn("specialZoneDeleteBtn.addEventListener", toolbar_content)
        self.assertIn("function createSpecialZoneEditorController", owner_content)
        self.assertIn("const renderSpecialZoneEditorUI =", owner_content)
        self.assertIn("const bindSpecialZoneEditorEvents =", owner_content)
        self.assertIn("Layer-based special zones are the canonical editor.", owner_content)
        self.assertNotIn("startSpecialZoneDraw({", owner_content)
        self.assertNotIn("deleteSelectedManualSpecialZone();", owner_content)
        self.assertNotIn('id="specialZoneTypeSelect"', index_html)
        self.assertNotIn('id="specialZoneStartBtn"', index_html)
        self.assertNotIn('id="specialZoneDeleteBtn"', index_html)
        self.assertNotIn('document.getElementById("specialZoneTypeSelect")', toolbar_content)
        self.assertIn("./toolbar/special_zones_workbench_controller.js", toolbar_content)
        self.assertIn("createSpecialZonesWorkbenchController", toolbar_content)

    def test_toolbar_keeps_special_zone_facade_and_callback_registration(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        appearance_owner = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);', content)
        self.assertIn("specialZoneEditorController.normalizeSpecialZoneEditorState();", content)
        self.assertIn("specialZoneEditorController.bindSpecialZoneEditorEvents();", content)
        self.assertIn("const openSpecialZonePopover = async () => {", content)
        self.assertIn("openSpecialZonePopover();", appearance_owner)
        self.assertIn('appearanceSpecialZoneBtn.setAttribute("aria-controls", "specialZonePopover");', appearance_owner)

    def test_special_zone_persistence_contract_stays_stable(self):
        file_manager = FILE_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        ui_state = (REPO_ROOT / "js" / "core" / "state" / "ui_state.js").read_text(encoding="utf-8")

        self.assertIn("specialZones: appState.specialZones || {}", file_manager)
        self.assertIn("specialZoneLayers: serializeSpecialZoneLayersState(appState.specialZoneLayers, {", file_manager)
        self.assertIn("specialZoneMembershipBrushMode: normalizeSpecialZoneMembershipBrushModeState(appState.specialZoneMembershipBrushMode)", file_manager)
        self.assertNotIn("specialRegionOverrides: {}", file_manager)
        self.assertIn('manualSpecialZones: { type: "FeatureCollection", features: [] }', file_manager)
        self.assertIn("data.styleConfig.specialZones = null;", file_manager)
        self.assertIn("state.specialZones = data.specialZones || {}", interaction_funnel)
        self.assertIn("state.specialZoneLayers = normalizeSpecialZoneLayersState", interaction_funnel)
        self.assertIn("state.specialZoneMembershipBrushMode = normalizeSpecialZoneMembershipBrushModeState", interaction_funnel)
        self.assertIn("state.specialRegionOverrides = {};", interaction_funnel)
        self.assertIn("state.manualSpecialZones =", interaction_funnel)
        self.assertIn("restoreImportedStyleConfigState(state, data.styleConfig);", interaction_funnel)
        self.assertIn("specialZoneLayers: createEmptySpecialZoneLayersState()", ui_state)
        self.assertIn("specialZones: imported.specialZones && typeof imported.specialZones === \"object\"", ui_state)

    def test_special_zone_workbench_load_cache_is_scenario_scoped(self):
        owner_content = SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('let loadedScenarioLayerAssetId = "";', owner_content)
        self.assertIn("let loadedScenarioLayerRequestId = 0;", owner_content)
        self.assertIn('const scenarioId = String(runtimeState.activeScenarioId || "").trim();', owner_content)
        self.assertIn("if (isScenarioLayerCacheLoadedForContext(loadContext)) return runtimeState.specialZoneLayers;", owner_content)
        self.assertIn("loadedScenarioLayerAssetId = scenarioId;", owner_content)
        self.assertIn("loadedScenarioLayerRequestId = scenarioApplyRequestId;", owner_content)
        self.assertIn("await loadScenarioSpecialZoneLayers();", owner_content)
        self.assertIn('fetch("/__dev/scenario/special-zone-layers/save"', owner_content)
        self.assertIn("saveBtn.setAttribute(\"aria-busy\", \"true\");", owner_content)

    def test_special_zone_workbench_owns_overlay_toggle_and_diagnostics(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        special_zone_layers_content = (REPO_ROOT / "js" / "core" / "special_zone_layers.js").read_text(encoding="utf-8")
        scenario_resources_content = (REPO_ROOT / "js" / "core" / "scenario_resources.js").read_text(encoding="utf-8")

        self.assertIn("markDirty,", toolbar_content)
        self.assertIn("render,", toolbar_content)
        self.assertIn("updateToolUI,", toolbar_content)
        self.assertIn("showToast,", toolbar_content)
        self.assertIn('overlayToggleNode.dataset.specialZoneOverlayToggle = "true";', owner_content)
        self.assertIn("setSpecialZonesVisibilityState,", owner_content)
        self.assertIn('from "../../core/state/actions/special_zone_actions.js";', owner_content)
        self.assertIn("setSpecialZonesVisibilityState(runtimeState, Boolean(overlayToggleNode.checked));", owner_content)
        self.assertIn('overlayToggleNode.addEventListener("change", async () => {', owner_content)
        self.assertIn("if (runtimeState.showSpecialZones) {", owner_content)
        self.assertIn("render?.();", owner_content)
        self.assertNotIn("runtimeState.showSpecialZones = !!overlayToggleNode.checked;", owner_content)
        self.assertIn("await loadScenarioSpecialZoneLayers();", owner_content)
        self.assertIn('markDirty?.("toggle-special-zones");', owner_content)
        self.assertIn('let failedScenarioLayerAssetId = "";', owner_content)
        self.assertIn("resolveSpecialZoneTopologyFingerprint(runtimeState)", owner_content)
        self.assertIn('code === "topology_fingerprint_mismatch"', owner_content)
        self.assertIn("SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES.LOAD_FAILED", owner_content)
        self.assertIn("Special zone topology fingerprint mismatch", owner_content)
        self.assertIn("function resolveSpecialZoneTopologyFingerprint(runtimeState = {})", special_zone_layers_content)
        self.assertIn("resolveSpecialZoneTopologyFingerprint(state)", scenario_resources_content)
        self.assertIn("SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES.LOAD_FAILED", scenario_resources_content)

    def test_hgo_preview_entry_is_owned_by_scenario_selector(self):
        scenario_controls = SCENARIO_CONTROLS_JS.read_text(encoding="utf-8")
        hgo_controller = HGO_RUNTIME_PREVIEW_CONTROLLER_JS.read_text(encoding="utf-8")
        toolbar = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn('const HGO_RUNTIME_PREVIEW_OPTION_VALUE = "__hgo_runtime_preview__";', scenario_controls)
        self.assertIn("areHgoRuntimePreviewAssetsAvailable", scenario_controls)
        self.assertIn("buildHgoRuntimePreviewOptionPayload", scenario_controls)
        self.assertIn('"setHgoRuntimePreviewEnabledFn"', scenario_controls)
        self.assertIn("clearActiveScenarioCommand({", scenario_controls)
        self.assertIn('markDirtyReason: ""', scenario_controls)
        self.assertIn('import { resetZoomToFit } from "../core/map_renderer/public.js";', scenario_controls)
        self.assertIn("centerContent: true", scenario_controls)
        self.assertIn("centerX: true", scenario_controls)
        self.assertIn("centerY: true", scenario_controls)
        self.assertLess(
            scenario_controls.index('await callRuntimeHook(state, "setHgoRuntimePreviewEnabledFn", true);'),
            scenario_controls.index("resetZoomToFit({"),
        )
        self.assertIn("createButton = false", hgo_controller)
        self.assertIn(
            "const previewButton = button || (createButton ? createPreviewButton(documentRef, anchorButton) : null);",
            hgo_controller,
        )
        self.assertNotIn('id = "hgoRuntimePreviewBtn"', toolbar)

    def test_special_zone_workbench_gates_members_and_style_on_active_layer(self):
        owner_content = SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('title.textContent = translate("Members");', owner_content)
        self.assertIn('empty.textContent = translate("Select or create a layer before editing members.");', owner_content)
        self.assertIn('title.textContent = translate("Current layer style");', owner_content)
        self.assertIn('empty.textContent = translate("Select a layer to edit its style.");', owner_content)
        self.assertIn("special-zone-member-tool-btn", owner_content)
        self.assertIn("special-zone-preset-preview", owner_content)
        self.assertIn("special-zone-current-style-preview", owner_content)
        self.assertNotIn("Country / owner id", owner_content)
        self.assertNotIn("special-zone-members-add-country", owner_content)

    def test_special_zone_preset_previews_keep_consistent_rectangles(self):
        css_content = STYLE_CSS.read_text(encoding="utf-8")
        card_rule = re.search(r"\.special-zone-preset-card\s*\{(?P<body>[^}]+)\}", css_content)
        preview_rule = re.search(r"\.special-zone-preset-preview\s*\{(?P<body>[^}]+)\}", css_content)

        self.assertIsNotNone(card_rule)
        self.assertIsNotNone(preview_rule)
        self.assertIn("grid-template-columns: 96px minmax(0, 1fr);", card_rule.group("body"))
        self.assertIn("box-sizing: border-box;", css_content)
        self.assertIn("height: 38px;", preview_rule.group("body"))
        self.assertIn("width: 96px;", preview_rule.group("body"))

    def test_special_zone_membership_tools_have_explicit_renderer_modes(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        brush_content = (REPO_ROOT / "js/core/renderer/brush_interaction_session_owner.js").read_text(encoding="utf-8")

        self.assertIn("function getSpecialZoneMembershipTool()", renderer_content)
        self.assertIn('tool === "single" || tool === "multi" || tool === "brush"', renderer_content)
        self.assertIn('from "./renderer/brush_interaction_session_owner.js";', renderer_content)
        self.assertIn("} = createBrushInteractionSessionOwner({", renderer_content)
        self.assertIn("getSpecialZoneMembershipTool,", renderer_content)
        self.assertIn("getSpecialZoneMembershipBrushMode,", renderer_content)
        self.assertIn('membershipTool !== "brush" && !event?.shiftKey && !event?.altKey', brush_content)
        self.assertIn("if (handleSpecialZoneMembershipPointerDown(event)) return;", brush_content)
        self.assertIn("beginSpecialZoneMembershipDrag({", brush_content)
        self.assertIn("membershipTool,", brush_content)
        self.assertIn('brushMode: getSpecialZoneMembershipBrushMode()', brush_content)
        self.assertIn("refreshSpecialZonesWorkbenchUi();", renderer_content)
        self.assertIn("runtimeState.resolveSpecialZoneParentGroupTargetIdsFn = resolveSpecialZoneParentGroupTargetIds;", renderer_content)
        self.assertIn("getParentGroupFeatureIds", owner_content)
        self.assertIn("special-zone-members-add-parent-group", owner_content)

    def test_special_zone_hover_refresh_stays_targeted(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        notify_body = re.search(
            r"function notifyDevWorkspace\(\) \{(?P<body>.*?)\n\}\n\nfunction isDevSelectionEligibleFeature",
            renderer_content,
            re.S,
        )
        self.assertIsNotNone(notify_body)
        self.assertNotIn("refreshSpecialZonesWorkbenchUi", notify_body.group("body"))

        hover_body = re.search(
            r"function updateDevHoverHit\(hit = null\) \{(?P<body>.*?)\n\}\n\nfunction updateDevSelectedHit",
            renderer_content,
            re.S,
        )
        self.assertIsNotNone(hover_body)
        self.assertIn("refreshSpecialZonesWorkbenchCurrentTargetUiIfChanged();", hover_body.group("body"))
        self.assertNotIn("refreshSpecialZonesWorkbenchUi();", hover_body.group("body"))

        self.assertIn("function refreshSpecialZonesWorkbenchCurrentTargetUi()", renderer_content)
        self.assertIn("function refreshSpecialZonesWorkbenchCurrentTargetUiIfChanged()", renderer_content)
        self.assertIn("let specialZonesWorkbenchCurrentTargetSignature", renderer_content)
        self.assertIn("renderCurrentTargetActions", owner_content)
        self.assertIn("registerSpecialZonesWorkbenchRuntimeHooks", owner_content)
        actions_content = (REPO_ROOT / "js/core/state/actions/special_zone_actions.js").read_text(encoding="utf-8")
        self.assertIn('from "../../core/state/actions/special_zone_actions.js";', owner_content)
        self.assertIn("registerSpecialZonesWorkbenchRuntimeHooks(runtimeState, {", owner_content)
        self.assertIn("renderCurrentTarget: renderSpecialZonesWorkbenchCurrentTargetUi,", owner_content)
        self.assertIn('if (typeof hooks.renderCurrentTarget === "function") {', actions_content)
        self.assertIn("target.updateSpecialZonesWorkbenchCurrentTargetUIFn = hooks.renderCurrentTarget;", actions_content)
        self.assertIn("special-zone-member-current-target-row", owner_content)

    def test_special_zone_member_list_rendering_is_capped(self):
        owner_content = SPECIAL_ZONES_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("const MEMBER_LIST_INLINE_LIMIT = 60;", owner_content)
        self.assertIn("const MEMBER_LIST_INLINE_RENDER_COUNT = 30;", owner_content)
        self.assertIn("const MEMBER_DRAWER_RENDER_LIMIT = 80;", owner_content)
        self.assertIn("layer.memberFeatureIds.slice(0, MEMBER_LIST_INLINE_RENDER_COUNT)", owner_content)
        self.assertIn("special-zone-member-overflow-btn", owner_content)
        self.assertIn("openMemberDrawer(layer)", owner_content)

    def test_special_zone_phase_d_visible_copy_has_locale_entries(self):
        catalog_content = I18N_CATALOG_JS.read_text(encoding="utf-8")
        locales = json.loads(LOCALES_JSON.read_text(encoding="utf-8"))
        ui_locales = locales.get("ui") or {}
        keys = [
            "Special Region Reference",
            "Special Region Overrides Retired",
            "Special region color overrides retired. Use Special Zones layers for editable narrative regions.",
            "Inspect scenario-only basins and exposure zones. Use Special Zones layers for editable narrative regions.",
            "Batch import / set operations",
            "Paste feature ids separated by commas, spaces, or new lines",
            "Add imported ids",
            "Replace with imported ids",
            "Union with layer",
            "Subtract layer",
            "Intersect layer",
            "Story preview",
            "Create visible layers to preview a story sequence.",
            "All member ids",
            "View all",
            "Hide from legend",
            "Show in legend",
        ]

        for key in keys:
            with self.subTest(key=key):
                self.assertIn(key, catalog_content)
                self.assertIn(key, ui_locales)
                self.assertEqual(ui_locales[key].get("en"), key)
                self.assertTrue(ui_locales[key].get("zh"))

    def test_export_workbench_persistence_contract_stays_stable(self):
        file_manager = FILE_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        ui_state = (REPO_ROOT / "js" / "core" / "state" / "ui_state.js").read_text(encoding="utf-8")

        self.assertIn("exportWorkbenchUi: normalizeExportWorkbenchUiState(appState.exportWorkbenchUi)", file_manager)
        self.assertIn("data.exportWorkbenchUi = normalizeExportWorkbenchUiState(data.exportWorkbenchUi);", file_manager)
        self.assertIn("restoreImportedWorkbenchUiState(state, data, {", interaction_funnel)
        self.assertIn("normalizeExportWorkbenchState = normalizeExportWorkbenchUiState", ui_state)
        self.assertIn("importedState.exportWorkbenchUi.visibility", ui_state)
        self.assertIn("importedState.exportWorkbenchUi.layerVisibility", ui_state)

    def test_transport_workbench_owner_moves_to_controller_module(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        state_owner_content = TRANSPORT_WORKBENCH_STATE_OWNER_JS.read_text(encoding="utf-8")
        config_owner_content = TRANSPORT_WORKBENCH_CONFIG_OWNER_JS.read_text(encoding="utf-8")
        apply_owner_content = TRANSPORT_WORKBENCH_APPLY_BRIDGE_OWNER_JS.read_text(encoding="utf-8")
        preview_lifecycle_owner_content = TRANSPORT_WORKBENCH_PREVIEW_LIFECYCLE_OWNER_JS.read_text(encoding="utf-8")
        inspector_owner_content = TRANSPORT_WORKBENCH_INSPECTOR_OWNER_JS.read_text(encoding="utf-8")
        layer_order_owner_content = TRANSPORT_WORKBENCH_LAYER_ORDER_OWNER_JS.read_text(encoding="utf-8")
        lens_owner_content = TRANSPORT_WORKBENCH_LENS_OWNER_JS.read_text(encoding="utf-8")
        popover_owner_content = TRANSPORT_WORKBENCH_POPOVER_OWNER_JS.read_text(encoding="utf-8")
        right_deck_owner_content = TRANSPORT_WORKBENCH_RIGHT_DECK_OWNER_JS.read_text(encoding="utf-8")
        shell_owner_content = TRANSPORT_WORKBENCH_SHELL_OWNER_JS.read_text(encoding="utf-8")
        event_owner_content = TRANSPORT_WORKBENCH_EVENT_OWNER_JS.read_text(encoding="utf-8")
        descriptor_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_descriptor.js").read_text(encoding="utf-8")

        self.assertIn("export function createTransportWorkbenchController", owner_content)
        self.assertIn("./transport_workbench_state_owner.js", owner_content)
        self.assertIn("./transport_workbench_config_owner.js", owner_content)
        self.assertIn("./transport_workbench_apply_bridge_owner.js", owner_content)
        self.assertIn("./transport_workbench_preview_lifecycle_owner.js", owner_content)
        self.assertIn("./transport_workbench_inspector_owner.js", owner_content)
        self.assertIn("./transport_workbench_popover_owner.js", owner_content)
        self.assertIn("./transport_workbench_right_deck_owner.js", owner_content)
        self.assertIn("./transport_workbench_shell_owner.js", owner_content)
        self.assertIn("./transport_workbench_event_owner.js", owner_content)
        self.assertIn("const renderTransportWorkbenchUi = () => {", owner_content)
        self.assertIn("const bindTransportWorkbenchEvents = () => {", owner_content)
        self.assertIn("const initializeTransportWorkbenchRuntime = () => {", owner_content)
        self.assertIn("const openTransportWorkbench = (trigger = null) => {", owner_content)
        self.assertIn("const closeTransportWorkbench = ({ restoreFocus = true } = {}) => {", owner_content)
        expected_config_owner_helpers = [
            "normalizeTransportWorkbenchFamily",
            "normalizeTransportWorkbenchInspectorTab",
            "mapTransportWorkbenchLabelLevelToMaxLevel",
            "mapTransportWorkbenchMaxLevelToLabelLevel",
            "normalizeTransportWorkbenchEnum",
            "normalizeTransportWorkbenchMulti",
            "normalizeTransportWorkbenchDensityConfig",
            "normalizeTransportWorkbenchLayerOrder",
            "normalizeRoadTransportWorkbenchConfig",
            "normalizeRailTransportWorkbenchConfig",
            "normalizeAirportTransportWorkbenchConfig",
            "normalizePortTransportWorkbenchConfig",
            "normalizeMineralResourceTransportWorkbenchConfig",
            "normalizeEnergyFacilityTransportWorkbenchConfig",
            "normalizeIndustrialTransportWorkbenchConfig",
            "normalizeLogisticsHubTransportWorkbenchConfig",
        ]
        for helper_name in expected_config_owner_helpers:
            self.assertIn(f"export function {helper_name}", config_owner_content)
            self.assertIsNone(
                re.search(rf"\b(?:function|const|let)\s+{re.escape(helper_name)}\b", owner_content),
                f"{helper_name} should stay in transport_workbench_config_owner.js",
            )
        self.assertIn("export const TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS = TRANSPORT_WORKBENCH_INSPECTOR_TABS.map((tab) => tab.id);", config_owner_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS = listTransportWorkbenchRuntimeFamilyIds();", config_owner_content)
        self.assertIn('export { TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS } from "./transport_workbench_config_owner.js";', owner_content)
        forbidden_config_owner_side_effect_tokens = [
            "runtimeState",
            "document.",
            ".querySelector",
            ".addEventListener",
            "fetch(",
            "markDirty",
            "dispatchEvent",
            "localStorage",
        ]
        for token in forbidden_config_owner_side_effect_tokens:
            self.assertNotIn(token, config_owner_content)
        self.assertNotIn("function normalizeTransportWorkbenchFamily", toolbar_content)
        self.assertNotIn("function normalizeTransportWorkbenchInspectorTab", toolbar_content)
        self.assertNotIn("function normalizeRoadTransportWorkbenchConfig", toolbar_content)
        self.assertNotIn("function ensureTransportWorkbenchUiState", toolbar_content)
        self.assertIn("export function createTransportWorkbenchStateOwner(runtimeState)", state_owner_content)
        self.assertIn("createTransportWorkbenchStateOwner(runtimeState)", owner_content)
        self.assertNotIn("normalizeTransportWorkbenchUiState,", owner_content)
        self.assertIn("normalizeTransportWorkbenchUiState,", state_owner_content)
        self.assertIn("listTransportWorkbenchRuntimeFamilyIds", config_owner_content)
        self.assertIn("runtimeFamilyIds = TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS,", preview_lifecycle_owner_content)
        self.assertIn("ensureTransportWorkbenchUiState,", state_owner_content)
        self.assertIn("commitTransportWorkbenchUiState,", state_owner_content)
        self.assertIn("commitTransportWorkbenchPointDeltasState,", state_owner_content)
        self.assertIn('from "../../core/state/actions/transport_actions.js";', state_owner_content)
        self.assertIn("const previousUiState = ensureTransportWorkbenchUiState(runtimeState);", state_owner_content)
        self.assertIn("return commitTransportWorkbenchUiState(runtimeState, uiState);", state_owner_content)
        self.assertNotIn("Object.assign(previousUiState, normalizedUiState);", state_owner_content)
        self.assertNotIn("runtimeState.transportWorkbenchUi = normalizeTransportWorkbenchUiState(runtimeState.transportWorkbenchUi);", owner_content)
        self.assertNotIn("runtimeState.transportWorkbenchUi = normalizeTransportWorkbenchUiState(runtimeState.transportWorkbenchUi);", state_owner_content)
        self.assertNotIn("runtimeState.transportWorkbenchUi =", state_owner_content)
        for helper_name in [
            "setActivePackId",
            "setActiveFamily",
            "setInspectorTab",
            "updateFamilyConfig",
            "updateDisplayConfig",
            "moveLayerOrder",
            "prepareOpenState",
            "prepareCloseState",
        ]:
            self.assertIn(helper_name, state_owner_content)
        self.assertIn("transportWorkbenchStateOwner.updateFamilyConfig", owner_content)
        self.assertIn("transportWorkbenchStateOwner.updateDisplayConfig", owner_content)
        self.assertIn("transportWorkbenchStateOwner.moveLayerOrder", owner_content)
        self.assertIn("const isTransportWorkbenchRenderGenerationCurrent = (renderGeneration, familyId) =>", owner_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_CONTROL_SCHEMAS = deepFreeze({", descriptor_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_DEFAULT_CONFIGS = deepFreeze({", descriptor_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_SECTION_DEFAULTS = deepFreeze({", descriptor_content)
        self.assertIn("const TRANSPORT_WORKBENCH_DENSITY_FAMILY_ID_SET = new Set([", descriptor_content)
        self.assertIn("export const TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS = Object.freeze({", descriptor_content)
        self.assertIn("TRANSPORT_WORKBENCH_CONTROL_SCHEMAS,", right_deck_owner_content)
        self.assertIn("TRANSPORT_WORKBENCH_DEFAULT_CONFIGS,", config_owner_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_DEFAULT_CONFIGS,", owner_content)
        self.assertIn("TRANSPORT_WORKBENCH_SECTION_DEFAULTS,", state_owner_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_SECTION_DEFAULTS,", owner_content)
        self.assertIn("buildEnergyFacilitySubtypeControlOptions,", inspector_owner_content)
        self.assertNotIn("const TRANSPORT_WORKBENCH_CONTROL_SCHEMAS = {", owner_content)
        self.assertNotIn("const TRANSPORT_WORKBENCH_DEFAULT_CONFIGS = {", owner_content)
        self.assertNotIn("const TRANSPORT_WORKBENCH_SECTION_DEFAULTS = {", owner_content)
        self.assertIn("export function createTransportWorkbenchPreviewLifecycleOwner(runtimeState,", preview_lifecycle_owner_content)
        self.assertIn("let renderGeneration = 0;", preview_lifecycle_owner_content)
        self.assertNotIn("let transportWorkbenchRenderGeneration = 0;", owner_content)
        self.assertIn("transportWorkbenchPreviewLifecycleOwner.refreshPreview(context, { allowCarrierPrep })", owner_content)
        self.assertIn("transportWorkbenchPreviewLifecycleOwner.initializeRuntimeHooks();", owner_content)
        self.assertIn("transportWorkbenchPreviewLifecycleOwner.dispose();", owner_content)
        self.assertIn("renderFamilyPreview(context.family.id, context.config, {", preview_lifecycle_owner_content)
        self.assertIn("isCurrent: () => isRenderGenerationCurrent(candidateGeneration, context.family.id),", preview_lifecycle_owner_content)
        self.assertIn("listWarmupPlans = listTransportWorkbenchWarmupPlans,", preview_lifecycle_owner_content)
        self.assertIn("warmFamilyPreview = warmTransportWorkbenchFamilyPreview,", preview_lifecycle_owner_content)
        self.assertIn("setCarrierViewChangeListener = setTransportWorkbenchCarrierViewChangeListener,", preview_lifecycle_owner_content)
        self.assertIn("setFamilyPreviewSelectionListener = setTransportWorkbenchFamilyPreviewSelectionListener,", preview_lifecycle_owner_content)
        self.assertNotIn("warmTransportWorkbenchFamilyPreview,", owner_content)
        self.assertNotIn("listTransportWorkbenchWarmupPlans,", owner_content)
        self.assertNotIn("setTransportWorkbenchFamilyPreviewSelectionListener,", owner_content)
        self.assertIn("export function createTransportWorkbenchInspectorOwner({", inspector_owner_content)
        self.assertIn("export function buildTransportWorkbenchInspectorModel({", inspector_owner_content)
        self.assertIn("export function buildTransportWorkbenchInspectorRenderSignature({", inspector_owner_content)
        self.assertIn("export function buildManifestOnlyInspectorRows(", inspector_owner_content)
        self.assertIn("export function buildTransportWorkbenchDiagnosticRows(", inspector_owner_content)
        self.assertIn("rightDeckLabel,", inspector_owner_content)
        self.assertIn('["Right deck", rightDeckLabel || ""]', inspector_owner_content)
        self.assertIn('rightDeckLabel: t("Display / Aggregation / Labels / Coverage / Data", "ui")', owner_content)
        self.assertIn("transportWorkbenchInspectorOwner.renderInspectorDetails({", owner_content)
        self.assertIn("let lastInspectorDetailsRender = null;", inspector_owner_content)
        self.assertIn("buildTransportWorkbenchInspectorRenderSignature({", inspector_owner_content)
        self.assertIn("renderInspectorDetails,", inspector_owner_content)
        self.assertIn("renderDiagnosticsBody: (familyId, config) => transportWorkbenchInspectorOwner.renderDiagnosticsBody(familyId, config)", owner_content)
        self.assertIn("renderDiagnosticsBody(family.id, config)", right_deck_owner_content)
        self.assertIn("export function createTransportWorkbenchLensOwner({", lens_owner_content)
        self.assertIn("export function buildTransportWorkbenchLensModel({", lens_owner_content)
        self.assertIn("export function buildTransportWorkbenchLensRenderSignature(model = {})", lens_owner_content)
        self.assertIn("const transportWorkbenchLensOwner = createTransportWorkbenchLensOwner({", owner_content)
        self.assertIn('translate: (label) => t(label, "ui")', owner_content)
        self.assertIn("pickUiCopy,", owner_content)
        self.assertIn("createRow: (label, value) => transportWorkbenchInspectorOwner.createRow(label, value)", owner_content)
        self.assertIn("buildLensSummaryRows: (input) => transportWorkbenchInspectorOwner.buildLensSummaryRows(input)", owner_content)
        lens_body = self._arrow_function_body(owner_content, "renderTransportWorkbenchLensSections")
        self.assertIn("transportWorkbenchLensOwner.render({", lens_body)
        self.assertNotIn("transportWorkbenchLensSections.replaceChildren();", lens_body)
        self.assertNotIn("document.createElement(\"div\")", lens_body)
        self.assertNotIn("transportWorkbenchInspectorOwner.buildLensSummaryRows({", lens_body)
        self.assertNotIn("transportWorkbenchInspectorOwner.createRow(label, value)", lens_body)
        inspector_body = self._arrow_function_body(owner_content, "renderTransportWorkbenchInspector")
        self.assertIn("transportWorkbenchInspectorOwner.renderInspectorDetails({", inspector_body)
        self.assertIn("detailsNode: transportWorkbenchInspectorDetails,", inspector_body)
        self.assertIn("emptyCard: inspectorEmptyCard,", inspector_body)
        self.assertNotIn("transportWorkbenchInspectorDetails.replaceChildren();", inspector_body)
        self.assertNotIn("transportWorkbenchInspectorOwner.buildInspectorModel({", inspector_body)
        self.assertNotIn("transportWorkbenchInspectorOwner.createStateCardNode", inspector_body)
        self.assertNotIn("transportWorkbenchInspectorOwner.createRow(entry[0], entry[1]", inspector_body)
        self.assertIn("export function getTransportWorkbenchInspectorRowClassNames({", inspector_owner_content)
        self.assertIn("getRowClassNames: getTransportWorkbenchInspectorRowClassNames", inspector_owner_content)
        self.assertNotIn('row.classList.add("is-summary"', owner_content)
        self.assertNotIn('row.classList.add("is-selected"', owner_content)
        self.assertNotIn('row.classList.add("is-governance"', owner_content)
        self.assertNotIn('"Pack version", "Recipe version", "Last build"', owner_content)
        self.assertNotIn("const formatTransportWorkbenchOptionLabels = ", owner_content)
        self.assertNotIn("const formatTransportWorkbenchManifestTimestamp = ", owner_content)
        self.assertNotIn("const formatTransportWorkbenchRoadHiddenReason = ", owner_content)
        self.assertNotIn("const buildManifestOnlyInspectorRows = ", owner_content)
        self.assertNotIn("const buildTransportWorkbenchDiagnosticRows = ", owner_content)
        self.assertNotIn("const createTransportWorkbenchInspectorRow = ", owner_content)
        self.assertNotIn("const createTransportWorkbenchInspectorStateCard = ", owner_content)
        self.assertNotIn("const renderTransportWorkbenchDiagnosticsBody = ", owner_content)
        self.assertIn("export function createTransportWorkbenchLayerOrderOwner({", layer_order_owner_content)
        self.assertIn("export function buildTransportWorkbenchLayerOrderRows({", layer_order_owner_content)
        self.assertIn("const transportWorkbenchLayerOrderOwner = createTransportWorkbenchLayerOrderOwner({", owner_content)
        self.assertIn("const renderTransportWorkbenchLayerOrderPanel = () => transportWorkbenchLayerOrderOwner.render();", owner_content)
        self.assertIn('translate: (label) => t(label, "ui")', owner_content)
        self.assertIn("moveLayerOrder: (draggedFamilyId, targetFamilyId) => transportWorkbenchStateOwner.moveLayerOrder(draggedFamilyId, targetFamilyId)", owner_content)
        self.assertIn("getRenderContext: () => getTransportWorkbenchRenderContext()", owner_content)
        self.assertIn("renderInspector: (family, config, compareHeld) => renderTransportWorkbenchInspector(family, config, compareHeld)", owner_content)
        self.assertNotIn("let transportWorkbenchDraggedLayerId", owner_content)
        self.assertNotIn('item.addEventListener("dragstart"', owner_content)
        self.assertNotIn('"Live now"', owner_content)
        self.assertIn('"Live now"', layer_order_owner_content)
        self.assertIn("export function createTransportWorkbenchRightDeckOwner({", right_deck_owner_content)
        self.assertIn("TRANSPORT_WORKBENCH_CONTROL_SCHEMAS", right_deck_owner_content)
        self.assertIn("TRANSPORT_WORKBENCH_TAB_SECTION_MAP", right_deck_owner_content)
        self.assertIn("mapTransportWorkbenchLabelLevelToMaxLevel", right_deck_owner_content)
        self.assertIn("mapTransportWorkbenchMaxLevelToLabelLevel", right_deck_owner_content)
        self.assertIn("export function createTransportWorkbenchPopoverOwner({", popover_owner_content)
        self.assertIn("TRANSPORT_WORKBENCH_INLINE_HELP_COPY", popover_owner_content)
        self.assertIn("TRANSPORT_WORKBENCH_INLINE_HELP_SECTIONS", popover_owner_content)
        self.assertIn("const transportWorkbenchPopoverOwner = createTransportWorkbenchPopoverOwner({", owner_content)
        self.assertIn("infoPopover: transportWorkbenchInfoPopover,", owner_content)
        self.assertIn("sectionHelpPopover: transportWorkbenchSectionHelpPopover,", owner_content)
        self.assertIn("toggleInfoPopover: () => transportWorkbenchPopoverOwner.toggleInfoPopover(getTransportWorkbenchFamilyMeta()),", owner_content)
        self.assertIn("handlePopoverEscape: (event) => transportWorkbenchPopoverOwner.handleEscape(event),", owner_content)
        self.assertIn("createSectionHelpButton: (familyId, section) => transportWorkbenchPopoverOwner.createSectionHelpButton(familyId, section)", owner_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_INLINE_HELP_COPY", owner_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_INLINE_HELP_SECTIONS", owner_content)
        self.assertNotIn("let transportWorkbenchSectionHelpState", owner_content)
        self.assertNotIn("const renderTransportWorkbenchInfoContent = ", owner_content)
        self.assertNotIn("const toggleTransportWorkbenchInfoPopover = ", owner_content)
        self.assertNotIn("const renderTransportWorkbenchSectionHelpPopover = ", owner_content)
        self.assertNotIn("const toggleTransportWorkbenchSectionHelpPopover = ", owner_content)
        self.assertNotIn("const positionTransportWorkbenchSectionHelpPopover = ", owner_content)
        self.assertNotIn("const createTransportWorkbenchSectionHelpButton = ", owner_content)
        self.assertIn("isInfoPopoverOpen: () => transportWorkbenchPopoverOwner.isInfoPopoverOpen(),", owner_content)
        self.assertIn("renderInfoContent: (family) => transportWorkbenchPopoverOwner.renderInfoContent(family),", owner_content)
        self.assertIn("if (isInfoPopoverOpen()) {", shell_owner_content)
        self.assertIn("renderInfoContent(family);", shell_owner_content)
        self.assertIn("const transportWorkbenchRightDeckOwner = createTransportWorkbenchRightDeckOwner({", owner_content)
        self.assertIn('translate: (label) => t(label, "ui")', owner_content)
        self.assertIn("pickUiCopy,", owner_content)
        self.assertIn("getDisplayConfig: (familyId) => getTransportWorkbenchDisplayConfig(familyId)", owner_content)
        self.assertIn("isSectionOpen: (familyId, sectionKey) => !!runtimeState.transportWorkbenchUi?.sectionOpen?.[familyId]?.[sectionKey]", owner_content)
        self.assertIn("updateFamilyConfig: (familyId, key, nextValue, options) => updateTransportWorkbenchFamilyConfig(familyId, key, nextValue, options)", owner_content)
        self.assertIn("updateDisplayConfig: (familyId, updateFn) => updateTransportWorkbenchDisplayConfig(familyId, updateFn)", owner_content)
        self.assertIn("renderDiagnosticsBody: (familyId, config) => transportWorkbenchInspectorOwner.renderDiagnosticsBody(familyId, config)", owner_content)
        self.assertIn("transportWorkbenchRightDeckOwner.renderTabs({", owner_content)
        self.assertIn("renderTabSections(family, config, compareHeld, resolvedTab, mounts[resolvedTab]);", right_deck_owner_content)
        self.assertNotIn("const renderTransportWorkbenchControl = ", owner_content)
        self.assertNotIn("const createTransportWorkbenchSectionNode = ", owner_content)
        self.assertNotIn("const createTransportWorkbenchShellCard = ", owner_content)
        self.assertNotIn("const renderTransportWorkbenchTabSections = ", owner_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_CONTROL_SCHEMAS", owner_content)
        self.assertNotIn("TRANSPORT_WORKBENCH_TAB_SECTION_MAP", owner_content)
        self.assertNotIn("mapTransportWorkbenchLabelLevelToMaxLevel", owner_content)
        self.assertNotIn("mapTransportWorkbenchMaxLevelToLabelLevel", owner_content)
        self.assertNotIn("renderTransportWorkbenchInspectorTabs(nextContext.family", owner_content)
        shell_body = self._arrow_function_body(owner_content, "renderTransportWorkbenchShell")
        self.assertIn("transportWorkbenchShellOwner.render(context);", shell_body)
        self.assertNotIn("renderTransportWorkbenchInspectorTabs(", shell_body)
        self.assertNotIn("transportWorkbenchRightDeckOwner.renderTabs(", shell_body)
        self.assertNotIn("renderTransportWorkbenchInspector(", shell_body)
        self.assertNotIn("transportWorkbenchPackSelect.replaceChildren(", shell_body)
        self.assertNotIn("renderTransportWorkbenchPackSelect(family.id, context.activePackId);", shell_body)
        self.assertNotIn("const applyButtonState = getTransportWorkbenchApplyButtonState(family.id);", shell_body)
        self.assertNotIn("transportWorkbenchApplyBtn.disabled = !applyButtonState.enabled;", shell_body)
        self.assertNotIn("transportWorkbenchApplyBtn.textContent = applyButtonState.label;", shell_body)
        self.assertNotIn("export function getTransportWorkbenchPackOptionsSignature(packOptions) {", owner_content)
        self.assertNotIn("export function syncTransportWorkbenchPackSelectOptions({", owner_content)
        preview_controls_body = self._arrow_function_body(owner_content, "syncTransportWorkbenchPreviewControls")
        self.assertIn("transportWorkbenchShellOwner.syncPreviewControls();", preview_controls_body)
        self.assertNotIn("getTransportWorkbenchCarrierViewState", preview_controls_body)
        self.assertNotIn("transportWorkbenchRotateBtn?.setAttribute", preview_controls_body)
        self.assertIn("export function createTransportWorkbenchShellOwner({", shell_owner_content)
        self.assertIn("export function getTransportWorkbenchPackOptionsSignature(packOptions) {", shell_owner_content)
        self.assertIn("export function syncTransportWorkbenchPackSelectOptions({", shell_owner_content)
        self.assertIn("syncTransportWorkbenchPackSelectOptions({", shell_owner_content)
        self.assertIn("selectNode.dataset.packOptionsSignature !== nextSignature", shell_owner_content)
        self.assertIn("selectNode.dataset.packOptionsSignature = nextSignature;", shell_owner_content)
        self.assertIn("if (node.textContent === nextValue) return false;", shell_owner_content)
        self.assertIn("if (typeof node.getAttribute === \"function\" && node.getAttribute(name) === nextValue) return false;", shell_owner_content)
        self.assertIn("if (node[key] === value) return false;", shell_owner_content)
        self.assertIn("transportWorkbenchShellOwner.syncPreviewControls();", owner_content)
        self.assertIn("getApplyButtonState: (familyId) => getTransportWorkbenchApplyButtonState(familyId)", owner_content)
        self.assertIn("export function createTransportWorkbenchEventOwner({", event_owner_content)
        self.assertIn("export function bindTransportWorkbenchEventOnce(node, bind)", event_owner_content)
        self.assertIn("const transportWorkbenchEventOwner = createTransportWorkbenchEventOwner({", owner_content)
        self.assertIn("transportWorkbenchEventOwner.bind();", owner_content)
        self.assertIn("scenarioButton: scenarioTransportWorkbenchBtn,", owner_content)
        self.assertIn("appearanceButton: transportAppearanceWorkbenchBtn,", owner_content)
        self.assertIn("applyButton: transportWorkbenchApplyBtn,", owner_content)
        self.assertIn("familyTabs: transportWorkbenchFamilyTabs,", owner_content)
        self.assertIn("inspectorTabButtons: transportWorkbenchInspectorTabButtons,", owner_content)
        self.assertIn("handlePopoverEscape: (event) => transportWorkbenchPopoverOwner.handleEscape(event),", owner_content)
        self.assertIn("const activateFamilyTab = () => {", event_owner_content)
        self.assertIn('tabButton.addEventListener("click", activateFamilyTab);', event_owner_content)
        self.assertIn("const activateInspectorTab = () => {", event_owner_content)
        self.assertIn('tabButton.addEventListener("click", activateInspectorTab);', event_owner_content)
        self.assertIn('button.addEventListener("click", async () => {', event_owner_content)
        self.assertIn("await applyFamilyToMainMap(context);", event_owner_content)
        self.assertIn("renderShell(getRenderContext());", event_owner_content)
        self.assertIn("if (handlePopoverEscape(event)) return;", event_owner_content)
        self.assertIn("body.dataset.transportWorkbenchEscapeBound = \"true\";", event_owner_content)
        bind_body = self._arrow_function_body(owner_content, "bindTransportWorkbenchEvents")
        self.assertIn("transportWorkbenchEventOwner.bind();", bind_body)
        self.assertNotIn(".addEventListener(", bind_body)
        self.assertNotIn("document.body.dataset.transportWorkbenchEscapeBound", bind_body)
        self.assertNotIn('transportWorkbenchApplyBtn.addEventListener("click", async () => {', owner_content)
        self.assertNotIn('transportWorkbenchCompareBtn.addEventListener("pointerdown"', owner_content)
        self.assertNotIn('transportWorkbenchPackSelect.addEventListener("change"', owner_content)
        self.assertNotIn("transportWorkbenchFamilyTabs.forEach((button) => {", owner_content)
        self.assertNotIn("transportWorkbenchInspectorTabButtons.forEach((button) => {", owner_content)
        ui_body = self._arrow_function_body(owner_content, "renderTransportWorkbenchUi")
        self.assertRegex(
            ui_body,
            re.compile(
                r"renderTransportWorkbenchShell\(context\);[\s\S]*?"
                r"renderTransportWorkbenchLensSections\(context\.family, context\.config, context\.compareHeld\);[\s\S]*?"
                r"renderTransportWorkbenchInspector\(context\.family, context\.config, context\.compareHeld\);"
            ),
        )
        render_context_body = self._arrow_function_body(owner_content, "getTransportWorkbenchRenderContext")
        self.assertNotIn("refreshTransportWorkbenchPackGateReport(", render_context_body)
        self.assertIn("export function createTransportWorkbenchApplyBridgeOwner(runtimeState,", apply_owner_content)
        self.assertRegex(
            apply_owner_content,
            re.compile(
                r"export function createTransportWorkbenchApplyBridgeOwner\(runtimeState,[\s\S]*?"
                r"const transportWorkbenchPackGateReportByPackId = new Map\(\);[\s\S]*?"
                r"const transportWorkbenchPackGatePromiseByPackId = new Map\(\);"
            ),
        )
        self.assertIn("const getApplyButtonState = (familyId) => {", apply_owner_content)
        self.assertIn("const refreshPackGateReport = async (packId,", apply_owner_content)
        self.assertIn("createTransportWorkbenchApplyBridgeOwner(runtimeState, {", owner_content)
        self.assertIn("const applyTransportWorkbenchFamilyToMainMap = (context) => (", owner_content)
        self.assertIn("transportWorkbenchApplyBridgeOwner.applyFamilyToMainMap(context)", owner_content)
        self.assertNotIn("const gateReport = await refreshPackGateReport(activePackId);", owner_content)
        self.assertIn("const gateReport = await refreshPackGateReport(activePackId);", apply_owner_content)
        self.assertIn("await runtimeState.ensureContextLayerDataFn(", apply_owner_content)
        self.assertIn('markDirty("transport-workbench-apply")', apply_owner_content)
        self.assertIn('runtimeState.renderNowFn("transport-workbench-apply")', apply_owner_content)
        apply_listener_body = self._event_listener_body(event_owner_content, "button", "click")
        self.assertIn("renderShell(getRenderContext());", apply_listener_body)
        self.assertNotIn("renderTransportWorkbenchUi()", apply_listener_body)
        self.assertNotIn("renderTransportWorkbenchInspector(", apply_listener_body)

    def test_transport_workbench_preview_lifecycle_owner_guards_render_and_view_sync(self):
        controller_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        preview_owner_content = TRANSPORT_WORKBENCH_PREVIEW_LIFECYCLE_OWNER_JS.read_text(encoding="utf-8")
        carrier_content = TRANSPORT_WORKBENCH_CARRIER_JS.read_text(encoding="utf-8")

        self.assertRegex(preview_owner_content, r"const \w+Generation = \+\+renderGeneration;")
        self.assertRegex(
            preview_owner_content,
            re.compile(
                r"const isRenderGenerationCurrent = \(candidateGeneration, familyId\) => \([\s\S]*?"
                r"candidateGeneration === renderGeneration[\s\S]*?"
                r"!!runtimeState.transportWorkbenchUi\?\.open[\s\S]*?"
                r"normalizeTransportWorkbenchFamily\(runtimeState.transportWorkbenchUi\?\.activeFamily\) === familyId"
            ),
        )
        self.assertIn("if (!context.isOpen) {", preview_owner_content)
        self.assertIn('if (context.family.id === "layers") {', preview_owner_content)
        self.assertIn("clearAllTransportWorkbenchFamilyPreviews();", preview_owner_content)
        self.assertIn("const prepareCarrier = allowCarrierPrep", preview_owner_content)
        self.assertIn("ensureTransportWorkbenchCarrier(carrierMount)", preview_owner_content)
        self.assertIn("if (!isRenderGenerationCurrent(candidateGeneration, context.family.id))", preview_owner_content)
        self.assertIn("resizeTransportWorkbenchCarrier();", preview_owner_content)
        self.assertIn("syncPreviewControls();", preview_owner_content)
        self.assertIn("renderFamilyPreview(context.family.id, context.config, {", preview_owner_content)
        self.assertIn("createTransportWorkbenchPreviewViewKey(getCarrierViewState())", preview_owner_content)
        self.assertRegex(preview_owner_content, r'console\.error\("\[transport-workbench\][^"]*", error\);')
        self.assertIn("cancelAnimationFrame(previewViewSyncRaf);", preview_owner_content)
        self.assertIn("renderGeneration += 1;", preview_owner_content)
        self.assertIn("previewLastViewKey = \"\";", preview_owner_content)
        self.assertIn("destroyFamilyPreviews();", preview_owner_content)
        self.assertIn("destroyCarrier();", preview_owner_content)
        self.assertIn("function createTransportWorkbenchPreviewViewKey(viewState = {})", preview_owner_content)
        self.assertIn("if (previewLastViewKey === nextViewKey) {", preview_owner_content)
        self.assertIn("const context = getRenderContext();", preview_owner_content)
        self.assertIn("if (!context.isOpen || context.family.id !== activeFamily) return;", preview_owner_content)
        self.assertIn("refreshPreview(context, { allowCarrierPrep: false, viewOnly: true });", preview_owner_content)
        self.assertIn("const schedulePreviewWarmup = () => {", preview_owner_content)
        self.assertIn("let previewWarmupScheduled = false;", preview_owner_content)
        self.assertIn("Promise.allSettled(", preview_owner_content)
        self.assertIn("warmFamilyPreview(plan.familyId, { includeFull: !!plan.includeFull })", preview_owner_content)
        self.assertIn("warnWarmupFailure(warmupPlans[index]?.familyId || \"unknown\", result.reason);", preview_owner_content)
        self.assertIn("const initializeRuntimeHooks = () => {", preview_owner_content)
        self.assertIn("setCarrierViewChangeListener(() => {", preview_owner_content)
        self.assertIn("destroyCarrier = destroyTransportWorkbenchCarrier,", preview_owner_content)
        self.assertIn("destroyFamilyPreviews = destroyAllTransportWorkbenchFamilyPreviews,", preview_owner_content)
        self.assertIn("scheduleViewSync();", preview_owner_content)
        self.assertIn("runtimeFamilyIds.forEach((familyId) => {", preview_owner_content)
        self.assertIn("setFamilyPreviewSelectionListener(familyId, () => {", preview_owner_content)
        self.assertIn("const pendingSelectionFamilyIds = new Set();", preview_owner_content)
        self.assertIn("selectionSyncRaf = requestAnimationFrame(() => {", preview_owner_content)
        self.assertIn("renderLensSections(context.family, context.config, context.compareHeld);", preview_owner_content)
        self.assertIn("renderInspector(context.family, context.config, context.compareHeld);", preview_owner_content)
        self.assertRegex(
            preview_owner_content,
            re.compile(r"destroyFamilyPreviews\(\);\s*destroyCarrier\(\);\s*attachRuntimeListeners\(\);"),
        )
        self.assertIn("transportWorkbenchPreviewLifecycleOwner.initializeRuntimeHooks();", controller_content)
        self.assertNotIn("setTransportWorkbenchCarrierViewChangeListener(() => {", controller_content)
        self.assertNotIn("setTransportWorkbenchFamilyPreviewSelectionListener(familyId, () => {", controller_content)
        self.assertNotIn("warmTransportWorkbenchFamilyPreview(plan.familyId", controller_content)
        self.assertIn("const scheduleTransportWorkbenchSurfaceRefresh = ({ allowCarrierPrep = false } = {}) => {", controller_content)
        self.assertIn("pendingWorkbenchRefreshFrame = requestWorkbenchRefreshFrame(() => {", controller_content)
        self.assertIn("scheduleTransportWorkbenchSurfaceRefresh({ allowCarrierPrep: false });", controller_content)
        self.assertIn("cancelWorkbenchRefreshFrame(pendingWorkbenchRefreshFrame);", controller_content)
        self.assertIn("stepCarrierZoom: (step) => stepTransportWorkbenchCarrierZoom(step),", controller_content)
        self.assertIn("rotateCarrier: () => toggleTransportWorkbenchCarrierQuarterTurn(),", controller_content)
        self.assertIn("function notifyCarrierViewChange()", carrier_content)
        self.assertIn("viewChangeNotificationFrame = requestCarrierFrame(() => {", carrier_content)
        self.assertIn("notifyCarrierViewChange();", carrier_content)
        self.assertNotIn("viewChangeListener?.(getTransportWorkbenchCarrierViewState());", carrier_content)

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
        transport_content = TRANSPORT_WORKBENCH_CONTROLLER_JS.read_text(encoding="utf-8")
        self.assertTrue("state.closeDockPopoverFn?.({ restoreFocus: false });" in transport_content or "runtimeState.closeDockPopoverFn?.({ restoreFocus: false });" in transport_content)
        self.assertTrue("state.closeExportWorkbenchFn?.({ restoreFocus: false });" in transport_content or "runtimeState.closeExportWorkbenchFn?.({ restoreFocus: false });" in transport_content)

    def test_appearance_controller_owns_transport_appearance_and_shell_logic(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        transport_owner_content = TRANSPORT_APPEARANCE_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createAppearanceControlsController", owner_content)
        self.assertIn("const applyAppearanceFilter = () => {", owner_content)
        self.assertIn("const setAppearanceTab = (tabId = \"borders\") => {", owner_content)
        self.assertIn('button.setAttribute("aria-selected", isActive ? "true" : "false");', owner_content)
        self.assertNotIn('button.setAttribute("aria-pressed", isActive ? "true" : "false");', owner_content)
        self.assertIn("createTransportAppearanceController({", owner_content)
        self.assertIn("const renderTransportAppearanceUi = () => {", owner_content)
        self.assertIn("transportAppearanceController.renderTransportAppearanceUi();", owner_content)
        self.assertIn("renderLayerStatusSummaries();", owner_content)
        self.assertIn("transportAppearanceController.bindEvents();", owner_content)
        self.assertIn("export function createTransportAppearanceController", transport_owner_content)
        self.assertIn("const getTransportAppearanceConfig = () => {", transport_owner_content)
        self.assertIn("const renderTransportAppearanceUi = () => {", transport_owner_content)
        self.assertIn("const renderRecentColors = () => {", owner_content)
        self.assertIn("const renderParentBorderCountryList = () => parentBorderOwner.renderCountryList();", owner_content)
        self.assertIn("const bindEvents = () => {", owner_content)
        self.assertNotIn("const getTransportAppearanceConfig = () => {", toolbar_content)
        self.assertNotIn("const getTransportAppearanceConfig = () => {", owner_content)
        self.assertNotIn("const applyAppearanceFilter = () => {", toolbar_content)
        self.assertNotIn("function renderRecentColors()", toolbar_content)
        self.assertNotIn("function renderParentBorderCountryList()", toolbar_content)
        self.assertIn("if (toggleAirports) toggleAirports.checked = !!runtimeState.showAirports;", transport_owner_content)
        self.assertIn("if (togglePorts) togglePorts.checked = !!runtimeState.showPorts;", transport_owner_content)
        for field in ("airportLabelMode", "airportScopeLinked", "airportScope", "airportImportanceThreshold"):
            self.assertIn(field, transport_owner_content)
        for field in ("portLabelMode", "portScopeLinked", "portTier", "portImportanceThreshold"):
            self.assertIn(field, transport_owner_content)
        self.assertIn("setTransportFamilyVisibilityState,", transport_owner_content)
        self.assertIn("setTransportMasterVisibilityState,", transport_owner_content)
        self.assertIn('from "../../core/state/actions/transport_actions.js";', transport_owner_content)
        self.assertIn("setTransportMasterVisibilityState(runtimeState, normalized);", transport_owner_content)
        for family_id in ("airport", "port", "rail", "road"):
            self.assertIn(
                f'setTransportFamilyVisibilityState(runtimeState, "{family_id}", event.target.checked);',
                transport_owner_content,
            )
        self.assertNotIn("runtimeState.showAirports =", transport_owner_content)
        self.assertNotIn("runtimeState.showPorts =", transport_owner_content)
        self.assertNotIn("runtimeState.showTransport =", transport_owner_content)
        self.assertIn("[toggleAirports, togglePorts, toggleRail, toggleRoad].forEach((control) => {", transport_owner_content)
        self.assertIn("if (control) control.disabled = false;", transport_owner_content)
        self.assertIn("let transportAppearanceUiFrameId = 0;", transport_owner_content)
        self.assertIn("const renderTransportAppearanceDirty = (reason) => {", transport_owner_content)
        self.assertIn('renderDirty(normalizedReason || "transport-appearance");', transport_owner_content)
        self.assertIn("if (transportAppearanceUiFrameId) return;", transport_owner_content)
        self.assertIn("transportAppearanceUiFrameId = scheduleTransportAppearanceFrame(() => {", transport_owner_content)

    def test_layer_panel_contracts_own_status_anchors_and_layer_definitions(self):
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        diagnostics_content = LAYER_STATUS_DIAGNOSTICS_JS.read_text(encoding="utf-8")
        contract_content = LAYER_PANEL_CONTRACTS_JS.read_text(encoding="utf-8")
        thematic_catalog_content = THEMATIC_LAYER_CATALOG_JS.read_text(encoding="utf-8")
        thematic_preview_content = THEMATIC_LAYER_PREVIEW_CONTROLLER_JS.read_text(encoding="utf-8")
        index_content = INDEX_HTML.read_text(encoding="utf-8")

        self.assertIn("from \"./layer_panel_contracts.js\";", controller_content)
        self.assertIn("getLayerPanelStatusAnchorMap", controller_content)
        self.assertIn("const layerStatusAnchorById = getLayerPanelStatusAnchorMap();", controller_content)
        self.assertNotIn("const layerStatusAnchorById = Object.freeze({", controller_content)
        self.assertIn("./thematic_layer_preview_controller.js", controller_content)
        self.assertIn("thematicCatalogPreview: thematicLayerPreviewController?.getPreview?.() || null", controller_content)

        self.assertIn("from \"./layer_panel_contracts.js\";", diagnostics_content)
        self.assertIn("listBaseLayerStatusContracts", diagnostics_content)
        self.assertIn("listTransportLayerPanelContracts", diagnostics_content)
        self.assertIn("buildThematicCatalogDiagnostic", diagnostics_content)
        self.assertNotIn("const LAYER_DEFINITIONS = Object.freeze([", diagnostics_content)

        self.assertIn("export function listLayerPanelContracts()", contract_content)
        self.assertIn("export function listThematicLayerPanelContracts()", contract_content)
        self.assertIn("export function getLayerPanelUnsupportedReason", contract_content)
        self.assertIn("../../core/thematic_layer_catalog.js", contract_content)
        self.assertIn("../../core/transport_capability_registry.js", contract_content)
        self.assertIn("resolveThematicLayerCatalogAssetKey", thematic_catalog_content)
        self.assertIn("getAsset", thematic_catalog_content)
        self.assertIn("resolveThematicLayerManifestAssetKey", thematic_catalog_content)
        self.assertIn("createThematicLayerPreviewController", thematic_preview_content)
        self.assertIn("buildThematicCatalogDiagnostic", thematic_preview_content)
        self.assertNotIn("markDirty", thematic_preview_content)
        self.assertNotIn("requestRender", thematic_preview_content)
        self.assertNotIn("pushHistoryEntry", thematic_preview_content)
        self.assertNotIn("runtimeState", thematic_preview_content)
        self.assertIn("mapContentTabThematic", index_content)
        self.assertIn("mapContentPanelThematic", index_content)
        self.assertIn("thematicLayerPreviewList", index_content)

    def test_appearance_preset_apply_loads_city_points_base_data_before_optional_layer(self):
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        loader_body = self._arrow_function_body(owner_content, "ensureAppearancePresetLayerData")

        self.assertIn('const loadOptions = { reason: "appearance-preset-apply", renderNow: true };', loader_body)
        base_loader = loader_body.index("runtimeState.ensureBaseCityDataFn(loadOptions);")
        optional_loader = loader_body.index('ensureActiveScenarioOptionalLayerLoaded("cities", loadOptions);')
        self.assertLess(base_loader, optional_loader)

    def test_toolbar_keeps_appearance_facade_and_state_registration_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        call_body = self._controller_call_body(content, "createAppearanceControlsController")

        self.assertIn("runtimeState: state,", content)
        self.assertIn("clamp,", call_body)
        self.assertIn("markDirty,", call_body)
        self.assertIn("normalizeOceanFillColor,", call_body)
        self.assertIn('registerRuntimeHook(state, "updateTransportAppearanceUIFn", renderTransportAppearanceUi);', content)
        self.assertIn('registerRuntimeHook(state, "updateRecentUI", () => {', content)
        self.assertIn('registerRuntimeHook(state, "updateParentBorderCountryListFn", renderParentBorderCountryList);', content)
        self.assertIn("bindAppearanceControlEvents();", content)
        self.assertIn("setAppearanceTabController(\"borders\");", content)
        self.assertNotIn("const setAppearanceTab = (tabId) => {", content)
        self.assertNotIn('document.querySelectorAll("[data-appearance-tab]")', content)
        self.assertNotIn('document.querySelectorAll("[data-appearance-panel]")', content)
        self.assertIn("applyAppearanceFilter();", content)

    def test_appearance_texture_owner_moves_texture_and_day_night_logic_out_of_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_TEXTURE_OWNER_JS.read_text(encoding="utf-8")
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("from \"./appearance_texture_owner.js\";", controller_content)
        self.assertIn("const textureOwner = createAppearanceTextureOwner({", controller_content)
        self.assertIn("const renderTextureUI = textureOwner.renderTextureUI;", controller_content)
        self.assertIn("const renderDayNightUI = textureOwner.renderDayNightUI;", controller_content)
        self.assertIn("textureOwner.bindEvents();", controller_content)
        self.assertIn("export function createAppearanceTextureOwner({", owner_content)
        self.assertIn("export const TEXTURE_STYLE_PATHS = Object.freeze([", owner_content)
        self.assertIn("const syncDayNightConfig = () => {", owner_content)
        self.assertIn("const renderTextureModePanels = (mode = runtimeState.styleConfig.texture?.mode || \"none\") => {", owner_content)
        self.assertIn("const renderTextureUI = () => {", owner_content)
        self.assertIn("const renderDayNightUI = () => {", owner_content)
        self.assertIn("runtimeState.syncDayNightClockTimerFn?.();", owner_content)
        self.assertIn("const updateTextureStyle = (mutate, { historyKind = \"texture-style\", commitHistory = false, renderReason = \"texture-style\" } = {}) => {", owner_content)
        self.assertIn("const bindTextureRange = (element, handler) => {", owner_content)
        self.assertIn("bindTextureRange(nodes.textureGraticuleColor,", owner_content)
        self.assertIn("bindTextureRange(nodes.textureDraftColor,", owner_content)
        self.assertNotIn('document.getElementById("textureSelect")', controller_content)
        self.assertNotIn('document.getElementById("dayNightEnabled")', controller_content)
        self.assertNotIn('document.getElementById("textureSelect")', toolbar_content)
        self.assertNotIn('document.getElementById("dayNightEnabled")', toolbar_content)
        self.assertNotIn("const syncDayNightConfig = () => {", controller_content)
        self.assertNotIn("const renderTextureModePanels = (mode = runtimeState.styleConfig.texture?.mode || \"none\") => {", controller_content)
        self.assertNotIn("const renderTextureUI = () => {", controller_content)
        self.assertNotIn("const renderDayNightUI = () => {", controller_content)
        self.assertNotIn("const updateTextureStyle = (mutate, { historyKind = \"texture-style\", commitHistory = false", controller_content)
        self.assertNotIn("const bindTextureRange = (element, handler) => {", controller_content)
        self.assertNotIn("const bindTextureColorInput = (element, handler) => {", controller_content)
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

    def test_toolbar_leaves_appearance_state_normalization_to_owners(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        for symbol in (
            "normalizePhysicalStyleConfig",
            "normalizeTextureStyleConfig",
            "normalizeUrbanStyleConfig",
        ):
            self.assertNotIn(symbol, content)
        for state_write in (
            "runtimeState.styleConfig.physical =",
            "runtimeState.styleConfig.rivers =",
            "runtimeState.styleConfig.texture =",
            "runtimeState.styleConfig.urban =",
            "runtimeState.referenceImageState =",
        ):
            self.assertNotIn(state_write, content)

    def test_zoom_toolbar_update_avoids_rewriting_clean_dom_state(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        self.assertIn("if (zoomPercentInput.value !== text)", content)
        self.assertIn('zoomPercentInput.hasAttribute("aria-invalid")', content)
        self.assertIn("if (zoomPercentInput.dataset.zoomError)", content)

    def test_appearance_city_points_owner_moves_city_points_out_of_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        city_points_owner_content = APPEARANCE_CITY_POINTS_OWNER_JS.read_text(encoding="utf-8")
        city_points_descriptor_content = APPEARANCE_CITY_POINTS_DESCRIPTOR_JS.read_text(encoding="utf-8")
        owner_call = self._controller_call_body(controller_content, "createAppearanceCityPointsOwner")

        self.assertIn("from \"./appearance_city_points_owner.js\";", controller_content)
        self.assertIn("const cityPointsOwner = createAppearanceCityPointsOwner({", controller_content)
        self.assertIn("runtimeState,", owner_call)
        self.assertIn("t,", owner_call)
        self.assertIn("clamp,", owner_call)
        self.assertIn("renderDirty: scheduleLayerRenderDirty,", owner_call)
        self.assertIn("normalizeOceanFillColor,", owner_call)
        self.assertIn("ensureActiveScenarioOptionalLayerLoaded,", owner_call)
        self.assertIn("cityPointsOwner.renderCityPointsUi();", controller_content)
        self.assertIn("cityPointsOwner.bindEvents();", controller_content)
        self.assertIn("export function createAppearanceCityPointsOwner({", city_points_owner_content)
        self.assertIn("const syncCityPointsConfig = () => {", city_points_owner_content)
        self.assertIn("const ensureCityPointsThemeOptions = () => {", city_points_owner_content)
        self.assertIn("CITY_POINTS_THEME_OPTIONS,", city_points_owner_content)
        self.assertIn("getCityPointsThemeMeta,", city_points_owner_content)
        self.assertIn("getCityPointsThemeStyle,", city_points_owner_content)
        self.assertIn("formatCityPointsDensityValue,", city_points_owner_content)
        self.assertIn('documentRef.getElementById("toggleCityPoints")', city_points_owner_content)
        self.assertIn('documentRef.getElementById("cityPointsTheme")', city_points_owner_content)
        self.assertIn('documentRef.getElementById("toggleStrategicResourceMarkers")', city_points_owner_content)
        self.assertIn('documentRef.getElementById("strategicChoroplethMetric")', city_points_owner_content)
        self.assertIn('void ensureActiveScenarioOptionalLayerLoaded("cities", { renderNow: true });', city_points_owner_content)
        self.assertIn('void ensureActiveScenarioOptionalLayerLoaded("strategicvalues", {', city_points_owner_content)
        self.assertIn('renderDirty("toggle-city-points");', city_points_owner_content)
        self.assertIn('renderDirty("toggle-strategic-resource-markers");', city_points_owner_content)
        self.assertIn('bindCityPointsChange(nodes.strategicChoroplethMetric,', city_points_owner_content)
        self.assertIn('"strategic-choropleth-metric"', city_points_owner_content)
        index_content = INDEX_HTML.read_text(encoding="utf-8")
        self.assertIn('id="toggleStrategicResourceMarkers"', index_content)
        self.assertIn('id="strategicChoroplethMetric"', index_content)
        self.assertIn('data-i18n="Strategic Values"', index_content)
        self.assertIn("export const CITY_POINTS_THEME_OPTIONS = Object.freeze([", city_points_descriptor_content)
        self.assertIn("export const CITY_POINTS_THEME_DEFAULT_STYLES = Object.freeze({", city_points_descriptor_content)
        self.assertIn("export function getCityPointsThemeMeta", city_points_descriptor_content)
        self.assertIn("export function getCityPointsThemeHint", city_points_descriptor_content)
        self.assertIn("export function getCityPointsLabelDensityHint", city_points_descriptor_content)
        self.assertIn("export function formatCityPointsDensityValue", city_points_descriptor_content)
        self.assertNotIn("const CITY_POINTS_THEME_OPTIONS =", city_points_owner_content)
        self.assertNotIn("const CITY_POINTS_THEME_DEFAULT_STYLES =", city_points_owner_content)
        self.assertNotIn("const formatCityPointsDensityValue = (value)", city_points_owner_content)
        self.assertNotIn('document.getElementById("toggleCityPoints")', controller_content)
        self.assertNotIn('document.getElementById("cityPointsTheme")', controller_content)
        self.assertNotIn('document.getElementById("toggleStrategicResourceMarkers")', controller_content)
        self.assertNotIn('document.getElementById("strategicChoroplethMetric")', controller_content)
        self.assertNotIn('document.getElementById("toggleCityPoints")', toolbar_content)
        self.assertNotIn('document.getElementById("cityPointsTheme")', toolbar_content)
        self.assertNotIn('document.getElementById("toggleStrategicResourceMarkers")', toolbar_content)
        self.assertNotIn('document.getElementById("strategicChoroplethMetric")', toolbar_content)
        self.assertNotIn("const syncCityPointsConfig = () => {", controller_content)
        self.assertNotIn("const syncCityPointsConfig = () => {", toolbar_content)
        self.assertNotIn("const persistCityViewSettings = () => {", toolbar_content)

    def test_appearance_render_scheduler_marks_dirty_before_batched_render(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        toolbar_call = self._controller_call_body(toolbar_content, "createAppearanceControlsController")

        self.assertIn("from \"./toolbar_render_scheduler.js\";", controller_content)
        self.assertIn("createToolbarDirtyRenderScheduler", controller_content)
        self.assertIn("shouldBatchToolbarRenderReason", controller_content)
        self.assertIn("markDirty,", controller_content)
        self.assertIn("requestRender,", controller_content)
        self.assertIn("createToolbarDirtyRenderScheduler({ markDirty, requestRender })", controller_content)
        self.assertIn("const renderLayerDirtyNow = (reason) => {", controller_content)
        self.assertIn("const scheduleLayerRenderDirty = (reason) => (", controller_content)
        self.assertIn("shouldBatchToolbarRenderReason(reason)", controller_content)
        self.assertIn("? layerRenderScheduler.schedule(reason)", controller_content)
        self.assertIn(": renderLayerDirtyNow(reason)", controller_content)
        self.assertIn("markDirty,", toolbar_call)
        self.assertIn("requestRender: () => {", toolbar_call)

    def test_appearance_physical_owner_moves_physical_controls_out_of_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        physical_owner_content = APPEARANCE_PHYSICAL_OWNER_JS.read_text(encoding="utf-8")
        owner_call = self._controller_call_body(controller_content, "createAppearancePhysicalOwner")

        self.assertIn("from \"./appearance_physical_owner.js\";", controller_content)
        self.assertIn("const physicalOwner = createAppearancePhysicalOwner({", controller_content)
        self.assertIn("runtimeState,", owner_call)
        self.assertIn("t,", owner_call)
        self.assertIn("clamp,", owner_call)
        self.assertIn("renderDirty: scheduleLayerRenderDirty,", owner_call)
        self.assertIn("normalizeOceanFillColor,", owner_call)
        self.assertIn("physicalOwner.renderPhysicalUi();", controller_content)
        self.assertIn("physicalOwner.bindEvents();", controller_content)
        self.assertIn("export function createAppearancePhysicalOwner({", physical_owner_content)
        self.assertIn("const syncPhysicalConfig = () => {", physical_owner_content)
        self.assertIn("const applyPhysicalPresetConfig = (preset, { preserveMode = true } = {}) => {", physical_owner_content)
        self.assertIn("const getPhysicalPresetHint = (preset) => {", physical_owner_content)
        self.assertIn("export const PHYSICAL_CLASS_TOGGLE_IDS = Object.freeze({", physical_owner_content)
        self.assertIn('documentRef.getElementById("togglePhysical")', physical_owner_content)
        self.assertIn('documentRef.getElementById("physicalPreset")', physical_owner_content)
        self.assertIn('documentRef.getElementById("physicalContourMajorInterval")', physical_owner_content)
        self.assertIn('void runtimeState.ensureContextLayerDataFn(["physical-set", "physical-contours-set"], { reason: "toolbar-toggle", renderNow: true });', physical_owner_content)
        self.assertIn('renderDirty("physical-preset-select");', physical_owner_content)
        self.assertNotIn('document.getElementById("togglePhysical")', controller_content)
        self.assertNotIn('document.getElementById("togglePhysical")', toolbar_content)
        self.assertNotIn('document.getElementById("physicalPreset")', controller_content)
        self.assertNotIn('document.getElementById("physicalPreset")', toolbar_content)
        self.assertNotIn("const syncPhysicalConfig = () => {", controller_content)
        self.assertNotIn("const syncPhysicalConfig = () => {", toolbar_content)
        self.assertNotIn("physicalPreset.addEventListener(\"change\", (event) => {", controller_content)
        self.assertNotIn("physicalPreset.addEventListener(\"change\", (event) => {", toolbar_content)

    def test_appearance_controller_keeps_urban_and_moves_rivers_to_owner(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        rivers_owner_content = APPEARANCE_RIVERS_OWNER_JS.read_text(encoding="utf-8")
        owner_call = self._controller_call_body(controller_content, "createAppearanceRiversOwner")

        self.assertIn("const syncUrbanConfig = () => {", controller_content)
        self.assertIn("const renderAppearanceStyleControlsUi = () => {", controller_content)
        self.assertIn("toggleUrban.addEventListener(\"change\", (event) => {", controller_content)
        self.assertIn("from \"./appearance_rivers_owner.js\";", controller_content)
        self.assertIn("const riversOwner = createAppearanceRiversOwner({", controller_content)
        self.assertIn("runtimeState,", owner_call)
        self.assertIn("clamp,", owner_call)
        self.assertIn("renderDirty: scheduleLayerRenderDirty,", owner_call)
        self.assertIn("normalizeOceanFillColor,", owner_call)
        self.assertIn("riversOwner.renderRiversUi();", controller_content)
        self.assertIn("riversOwner.bindEvents();", controller_content)
        self.assertIn("export function createAppearanceRiversOwner({", rivers_owner_content)
        self.assertIn('import { normalizeRiversStyleConfig } from "../../core/state.js";', rivers_owner_content)
        self.assertIn("export { normalizeRiversStyleConfig };", rivers_owner_content)
        self.assertIn("const syncRiversConfig = () => {", rivers_owner_content)
        self.assertIn('documentRef.getElementById("toggleRivers")', rivers_owner_content)
        self.assertIn('documentRef.getElementById("riversDashStyle")', rivers_owner_content)
        self.assertIn('void runtimeState.ensureContextLayerDataFn("rivers", { reason: "toolbar-toggle", renderNow: true });', rivers_owner_content)
        self.assertIn('renderDirty("rivers-dash");', rivers_owner_content)
        self.assertNotIn("const syncUrbanConfig = () => {", toolbar_content)
        self.assertNotIn("toggleUrban.addEventListener(\"change\", (event) => {", toolbar_content)
        self.assertNotIn('document.getElementById("toggleRivers")', toolbar_content)
        self.assertNotIn('document.getElementById("toggleRivers")', controller_content)
        self.assertNotIn('document.getElementById("riversDashStyle")', toolbar_content)
        self.assertNotIn('document.getElementById("riversDashStyle")', controller_content)
        self.assertNotIn("const syncRiversConfig = () => {", toolbar_content)
        self.assertNotIn("const syncRiversConfig = () => {", controller_content)
        self.assertNotIn("riversDashStyle.addEventListener(\"change\", (event) => {", controller_content)
        self.assertNotIn("riversDashStyle.addEventListener(\"change\", (event) => {", toolbar_content)

    def test_transport_appearance_owner_keeps_transport_control_dom_out_of_toolbar(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        transport_owner_content = TRANSPORT_APPEARANCE_CONTROLLER_JS.read_text(encoding="utf-8")

        for node_id in (
            "toggleAirports",
            "togglePorts",
            "toggleRail",
            "toggleRoad",
            "transportAppearanceMasterToggle",
            "airportVisualStrength",
            "portVisualStrength",
            "railVisualStrength",
            "roadVisualStrength",
        ):
            self.assertIn(f'document.getElementById("{node_id}")', transport_owner_content)
            self.assertNotIn(f'document.getElementById("{node_id}")', toolbar_content)

    def test_toolbar_keeps_city_urban_physical_special_zone_facade_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn("function renderSpecialZoneEditorUI() {", content)
        self.assertIn("renderAppearanceStyleControlsUi();", content)
        self.assertIn("specialZoneEditorController.renderSpecialZoneEditorUI();", content)
        self.assertIn('registerRuntimeHook(state, "updateSpecialZoneEditorUIFn", renderSpecialZoneEditorUI);', content)

    def test_appearance_parent_border_owner_moves_list_rendering_out_of_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        parent_border_owner_content = APPEARANCE_PARENT_BORDER_OWNER_JS.read_text(encoding="utf-8")

        self.assertIn("from \"./appearance_parent_border_owner.js\";", owner_content)
        self.assertIn("const parentBorderOwner = createAppearanceParentBorderOwner({", owner_content)
        self.assertIn("const syncParentBorderVisibilityUI = () => parentBorderOwner.syncVisibilityUi();", owner_content)
        self.assertIn("const renderParentBorderCountryList = () => parentBorderOwner.renderCountryList();", owner_content)
        self.assertIn("export function createAppearanceParentBorderOwner({", parent_border_owner_content)
        self.assertIn("export function normalizeParentBorderEnabledMap(runtimeState)", parent_border_owner_content)
        self.assertIn("export function buildParentBorderCountryRows({", parent_border_owner_content)
        self.assertIn("export function getParentBorderRowsSignature(rows = [])", parent_border_owner_content)
        self.assertIn("parentBorderOwner.bindEvents();", owner_content)
        self.assertIn("const bindEvents = () => {", parent_border_owner_content)
        self.assertIn("if (countryList.dataset.parentBorderRowsSignature === nextSignature)", parent_border_owner_content)
        self.assertIn("syncCountryCheckboxes(rows, enabled);", parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-country");', parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-color");', parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-opacity");', parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-width");', parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-visibility");', parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-enable-all");', parent_border_owner_content)
        self.assertIn('renderDirty("parent-border-disable-all");', parent_border_owner_content)
        self.assertNotIn("const normalizeParentBorderEnabledMap = () => {", owner_content)
        self.assertNotIn("parentBorderCountryList.replaceChildren();", owner_content)
        self.assertNotIn('checkbox.addEventListener("change", (event) => {', owner_content)
        self.assertNotIn('parentBorderColor.addEventListener("input"', toolbar_content)
        self.assertNotIn('parentBorderOpacity.addEventListener("input"', toolbar_content)
        self.assertNotIn('parentBorderWidth.addEventListener("input"', toolbar_content)
        self.assertNotIn('parentBordersVisible.addEventListener("change"', toolbar_content)
        self.assertNotIn('parentBorderEnableAll.addEventListener("click"', toolbar_content)
        self.assertNotIn('parentBorderDisableAll.addEventListener("click"', toolbar_content)
        self.assertNotIn("const normalizeParentBorderEnabledMap = () => {", toolbar_content)
        self.assertNotIn("parentBorderCountryList.replaceChildren();", toolbar_content)

    def test_appearance_reference_owner_moves_reference_overlay_logic_out_of_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        controller_content = APPEARANCE_CONTROLS_CONTROLLER_JS.read_text(encoding="utf-8")
        reference_owner_content = APPEARANCE_REFERENCE_OWNER_JS.read_text(encoding="utf-8")
        owner_call = self._controller_call_body(controller_content, "createAppearanceReferenceOwner")

        self.assertIn("from \"./appearance_reference_owner.js\";", controller_content)
        self.assertIn("const referenceOwner = createAppearanceReferenceOwner({", controller_content)
        self.assertIn("runtimeState,", owner_call)
        self.assertIn("clamp,", owner_call)
        self.assertIn("markDirty,", owner_call)
        self.assertIn("const renderReferenceOverlayUi = referenceOwner.renderReferenceOverlayUi;", controller_content)
        self.assertIn("clearReferenceImage: referenceOwner.clearReferenceImage,", controller_content)
        self.assertIn("referenceOwner.bindEvents();", controller_content)
        self.assertIn('import { normalizeReferenceImageState } from "../../core/state.js";', reference_owner_content)
        self.assertIn("export function createAppearanceReferenceOwner({", reference_owner_content)
        self.assertIn("export { normalizeReferenceImageState };", reference_owner_content)
        self.assertIn("export function getReferenceStyleSignature", reference_owner_content)
        self.assertIn('documentRef.getElementById("referenceImage")', reference_owner_content)
        self.assertIn('documentRef.getElementById("referenceImageInput")', reference_owner_content)
        self.assertIn("nodes.imageInput.addEventListener(\"change\", (event) => {", reference_owner_content)
        self.assertIn("markDirty(\"reference-image-file\");", reference_owner_content)
        self.assertIn("const clearReferenceImage = ({ markDirty: shouldMarkDirty = true } = {}) => {", reference_owner_content)
        self.assertIn("revokeReferenceUrl();", reference_owner_content)
        self.assertIn("nodes.imageInput.value = \"\";", reference_owner_content)
        self.assertIn('"reference-offset-y",', reference_owner_content)
        self.assertNotIn("const applyReferenceStyles = () => {", toolbar_content)
        self.assertNotIn("referenceImageInput.addEventListener(\"change\", (event) => {", toolbar_content)
        self.assertNotIn("const renderReferenceOverlayUi = () => {", controller_content)
        self.assertNotIn("referenceImageInput.addEventListener(\"change\", (event) => {", controller_content)
        self.assertNotIn('document.getElementById("referenceImageInput")', toolbar_content)
        self.assertNotIn('document.getElementById("referenceOpacity")', toolbar_content)

    def test_toolbar_keeps_reference_refresh_facade_contract(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertIn("renderReferenceOverlayUi();", content)
        self.assertIn('registerRuntimeHook(state, "clearReferenceImageFn", clearReferenceImage);', content)
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
        call_body = self._controller_call_body(content, "createOceanLakeControlsController")

        self.assertIn("clamp,", call_body)
        self.assertIn("normalizeOceanFillColor,", call_body)
        self.assertIn("bindEvents: bindOceanLakeControlEvents,", content)
        self.assertIn("renderOceanCoastalAccentUi,", content)
        self.assertIn("renderOceanLakeControlsUi,", content)
        self.assertIn("applyAutoFillOceanColor,", content)
        self.assertIn("renderOceanCoastalAccentUiForWorkspace = renderOceanCoastalAccentUi;", content)
        self.assertIn("renderOceanLakeControlsUi();", content)
        self.assertIn("bindOceanLakeControlEvents();", content)
        self.assertIn("const nextOceanFill = applyAutoFillOceanColor();", content)

    def test_workspace_refresh_hooks_wait_for_ocean_lake_facade(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")
        self._assert_workspace_refresh_hooks_wait_for_ocean_lake_facade(content)

    def test_dist_workspace_refresh_hooks_wait_for_ocean_lake_facade(self):
        if not DIST_TOOLBAR_JS.exists():
            self.skipTest("dist/app/js/ui/toolbar.js is only available after build_pages_dist runs")
        content = DIST_TOOLBAR_JS.read_text(encoding="utf-8")
        self._assert_workspace_refresh_hooks_wait_for_ocean_lake_facade(content)

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

    def test_quick_fill_policy_and_events_belong_to_support_surface_controller(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = WORKSPACE_CHROME_SUPPORT_SURFACE_CONTROLLER_JS.read_text(encoding="utf-8")
        for name in ["getActiveQuickFillPolicy", "getQuickFillParentLabel", "getQuickFillHint", "refreshQuickFillControls", "bindQuickFillControls"]:
            self.assertIn(f"const {name} =", owner_content)
            self.assertNotIn(f"const {name} =", toolbar_content)
        self.assertIn("bindQuickFillControls();", toolbar_content)
        self.assertIn("refreshQuickFillControls();", toolbar_content)
        self.assertIn('from "../../core/state/actions/scenario_presentation_actions.js";', owner_content)
        self.assertIn("setBatchFillScopeState(state, scope);", owner_content)
        self.assertNotIn("state.batchFillScope = scope;", owner_content)
        actions_content = (REPO_ROOT / "js/core/state/actions/scenario_presentation_actions.js").read_text(encoding="utf-8")
        self.assertIn('const nextScope = scope === "country" ? "country" : "parent";', actions_content)
        self.assertIn("target.batchFillScope = nextScope;", actions_content)
        self.assertIn("if (button.disabled) return;", owner_content)
        self.assertIn("refreshPaintModeUi();", owner_content)
        self.assertNotIn("runtimeState.batchFillScope =", toolbar_content)
        self.assertIn("const refreshPaintControlsLayout = () => {", toolbar_content)
        self.assertNotIn("refreshPaintControlsLayout", owner_content)


if __name__ == "__main__":
    unittest.main()
