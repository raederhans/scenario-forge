from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
WATER_SPECIAL_REGION_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "water_special_region_controller.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
HISTORY_MANAGER_JS = REPO_ROOT / "js" / "core" / "history_manager.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"


class WaterSpecialRegionSidebarBoundaryContractTest(unittest.TestCase):
    def test_sidebar_imports_water_special_region_controller(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('import { createWaterSpecialRegionController } from "./sidebar/water_special_region_controller.js";', content)
        self.assertIn('createWaterSpecialRegionController', content)

    def test_water_and_special_owner_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('export function createWaterSpecialRegionController({', owner_content)
        self.assertIn('const renderWaterInteractionUi = () => {', owner_content)
        self.assertIn('const renderWaterRegionList = () => {', owner_content)
        self.assertIn('const renderSpecialRegionInspectorUi = () => {', owner_content)
        self.assertIn('const renderSpecialRegionList = () => {', owner_content)
        self.assertIn('const closeWaterInspectorColorPicker = () => {', owner_content)
        self.assertIn('const closeSpecialRegionColorPicker = () => {', owner_content)
        self.assertIsNone(re.search(r"const\s+renderWaterInteractionUi\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderWaterRegionList\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderSpecialRegionInspectorUi\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderSpecialRegionList\s*=\s*\(\)\s*=>", sidebar_content))

    def test_sidebar_keeps_water_and_special_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('bindEvents: bindWaterSpecialRegionEvents,', content)
        self.assertIn('closeWaterInspectorColorPicker,', content)
        self.assertIn('closeSpecialRegionColorPicker,', content)
        self.assertIn('renderWaterInteractionUi,', content)
        self.assertIn('renderWaterRegionList,', content)
        self.assertIn('renderSpecialRegionInspectorUi,', content)
        self.assertIn('renderSpecialRegionList,', content)
        self.assertIn('bindWaterSpecialRegionEvents();', content)
        self.assertIn('state.renderWaterRegionListFn = renderWaterRegionList;', content)
        self.assertIn('state.updateWaterInteractionUIFn = renderWaterInteractionUi;', content)
        self.assertIn('state.renderSpecialRegionListFn = renderSpecialRegionList;', content)
        self.assertIn('state.updateScenarioSpecialRegionUIFn = renderSpecialRegionInspectorUi;', content)
        self.assertIn('state.updateScenarioReliefOverlayUIFn = renderSpecialRegionInspectorUi;', content)

    def test_water_search_binding_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertNotIn('waterSearchInput.addEventListener("input"', sidebar_content)
        self.assertIn('waterSearchInput.addEventListener("input"', owner_content)
        self.assertIn('specialRegionSearchInput.addEventListener("input"', owner_content)

    def test_controller_keeps_water_special_history_and_bridge_helpers(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('captureHistoryState({ waterRegionIds: nextIds })', owner_content)
        self.assertIn('captureHistoryState({ specialRegionIds: [selectedId] })', owner_content)
        self.assertIn('updateSpecialZoneEditorUi();', owner_content)
        self.assertIn('updateWorkspaceStatus();', owner_content)
        self.assertIn('updateSpecialZoneEditorUi: () => state.updateSpecialZoneEditorUIFn?.(),', sidebar_content)
        self.assertIn('updateWorkspaceStatus: () => state.updateWorkspaceStatusFn?.(),', sidebar_content)

    def test_renderer_history_and_import_funnel_keep_water_special_callbacks(self):
        map_renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        history_manager_content = HISTORY_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")

        self.assertIn('state.renderWaterRegionListFn();', map_renderer_content)
        self.assertIn('state.renderSpecialRegionListFn();', map_renderer_content)
        self.assertIn('state.renderWaterRegionListFn();', history_manager_content)
        self.assertIn('state.renderSpecialRegionListFn();', history_manager_content)
        self.assertIn('state.renderWaterRegionListFn();', interaction_funnel_content)
        self.assertIn('state.renderSpecialRegionListFn();', interaction_funnel_content)


if __name__ == "__main__":
    unittest.main()
