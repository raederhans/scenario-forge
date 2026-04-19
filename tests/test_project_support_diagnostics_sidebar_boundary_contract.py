from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "project_support_diagnostics_controller.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"


class ProjectSupportDiagnosticsSidebarBoundaryContractTest(unittest.TestCase):
    def test_sidebar_imports_project_support_diagnostics_controller(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('import { createProjectSupportDiagnosticsController } from "./sidebar/project_support_diagnostics_controller.js";', content)
        self.assertIn('createProjectSupportDiagnosticsController', content)

    def test_project_support_owner_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('export function createProjectSupportDiagnosticsController({', owner_content)
        self.assertIn('const renderScenarioAuditPanel = () => {', owner_content)
        self.assertIn('const refreshLegendEditor = () => {', owner_content)
        self.assertIn('const bindEvents = () => {', owner_content)
        self.assertIsNone(re.search(r"const\s+renderScenarioAuditPanel\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+refreshLegendEditor\s*=\s*\(\)\s*=>", sidebar_content))

    def test_sidebar_keeps_project_support_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('bindEvents: bindProjectSupportDiagnosticsEvents,', content)
        self.assertIn('refreshLegendEditor,', content)
        self.assertIn('renderScenarioAuditPanel,', content)
        self.assertIn('bindProjectSupportDiagnosticsEvents();', content)
        self.assertIn('state.renderScenarioAuditPanelFn = renderScenarioAuditPanel;', content)
        self.assertIn('state.updateLegendUI = refreshLegendEditor;', content)
        self.assertGreater(
            content.index('state.renderScenarioAuditPanelFn = renderScenarioAuditPanel;'),
            content.index('bindProjectSupportDiagnosticsEvents();')
        )

    def test_project_support_events_move_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertNotIn('downloadProjectBtn.addEventListener("click"', sidebar_content)
        self.assertNotIn('uploadProjectBtn.addEventListener("click"', sidebar_content)
        self.assertNotIn('projectFileInput.addEventListener("change"', sidebar_content)
        self.assertNotIn('debugModeSelect.addEventListener("change"', sidebar_content)
        self.assertIn('downloadProjectBtn.addEventListener("click"', owner_content)
        self.assertIn('uploadProjectBtn.addEventListener("click"', owner_content)
        self.assertIn('projectFileInput.addEventListener("change"', owner_content)
        self.assertIn('debugModeSelect.addEventListener("change"', owner_content)

    def test_controller_keeps_project_import_and_legend_helpers(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('legendManager: LegendManager,', sidebar_content)
        self.assertIn('fileManager: FileManager,', sidebar_content)
        self.assertIn('importProjectThroughFunnel,', sidebar_content)
        self.assertIn('invalidateFrontlineOverlayState: () => invalidateFrontlineOverlayState(),', sidebar_content)
        self.assertIn('legendManager.getUniqueColors(state)', owner_content)
        self.assertIn('fileManager.exportProject(state);', owner_content)
        self.assertIn('importProjectThroughFunnel(file, {', owner_content)
        self.assertIn('invalidateFrontlineOverlayState,', owner_content)

    def test_interaction_funnel_and_renderer_keep_project_support_callbacks(self):
        interaction_funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        map_renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn('state.updateLegendUI();', interaction_funnel_content)
        self.assertIn('state.renderScenarioAuditPanelFn();', interaction_funnel_content)
        self.assertIn('state.updateLegendUI();', map_renderer_content)


if __name__ == "__main__":
    unittest.main()
