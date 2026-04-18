from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
EXPORT_FAILURE_HANDLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "export_failure_handler.js"
PALETTE_LIBRARY_PANEL_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "palette_library_panel.js"
SCENARIO_GUIDE_POPOVER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "scenario_guide_popover.js"
SPECIAL_ZONE_EDITOR_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "special_zone_editor.js"
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

        self.assertIn("state.updatePaletteSourceUIFn = syncPaletteSourceControls;", content)
        self.assertIn("state.updatePaletteLibraryUIFn = renderPaletteLibrary;", content)
        self.assertIn("state.renderPaletteFn = renderPalette;", content)
        self.assertIn("bindPaletteLibraryPanelEvents();", content)
        self.assertIn("syncPaletteLibraryPanelVisibility();", content)

    def test_toolbar_keeps_export_failure_handler_call_sites(self):
        content = TOOLBAR_JS.read_text(encoding="utf-8")

        self.assertGreaterEqual(content.count("showExportFailureToast(error);"), 2)

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

        self.assertIn("state.restoreSupportSurfaceFromUrlFn = restoreSupportSurfaceFromUrl;", content)
        self.assertIn('syncSupportSurfaceUrlState("guide")', content)
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

        self.assertIn("state.updateSpecialZoneEditorUIFn = renderSpecialZoneEditorUI;", content)
        self.assertIn("specialZoneEditorController.normalizeSpecialZoneEditorState();", content)
        self.assertIn("specialZoneEditorController.bindSpecialZoneEditorEvents();", content)
        self.assertIn("openSpecialZonePopover();", content)
        self.assertIn('appearanceSpecialZoneBtn.setAttribute("aria-controls", "specialZonePopover");', content)

    def test_special_zone_persistence_contract_stays_stable(self):
        file_manager = FILE_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")

        self.assertIn("specialZones: appState.specialZones || {}", file_manager)
        self.assertIn('manualSpecialZones: appState.manualSpecialZones || { type: "FeatureCollection", features: [] }', file_manager)
        self.assertIn("specialZones: appState.styleConfig?.specialZones || null", file_manager)
        self.assertIn("state.specialZones = data.specialZones || {}", interaction_funnel)
        self.assertIn("state.manualSpecialZones =", interaction_funnel)
        self.assertIn("state.styleConfig.specialZones = {", interaction_funnel)


if __name__ == "__main__":
    unittest.main()
