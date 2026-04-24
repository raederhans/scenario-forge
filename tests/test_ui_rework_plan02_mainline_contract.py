from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class UiReworkPlan02MainlineContractTest(unittest.TestCase):
    def test_transport_moves_to_zoom_utility_and_leaves_context_bar(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        scenario_bar_start = content.index('<div id="scenarioContextBar"')
        scenario_bar_end = content.index('<div id="toastViewport"', scenario_bar_start)
        scenario_bar = content[scenario_bar_start:scenario_bar_end]
        self.assertIn('id="scenarioGuideBtn"', scenario_bar)
        self.assertNotIn('id="scenarioTransportWorkbenchBtn"', scenario_bar)

        zoom_controls_start = content.index('<div id="zoomControls"')
        zoom_controls_end = content.index('<section id="bottomDock"', zoom_controls_start)
        zoom_controls = content[zoom_controls_start:zoom_controls_end]
        self.assertIn('id="scenarioTransportWorkbenchBtn"', zoom_controls)
        self.assertIn('shell-utility-group-workspace', zoom_controls)

    def test_support_entries_are_text_buttons_and_dock_drops_long_config_and_clear(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="utilitiesGuideBtn" class="btn-secondary sidebar-support-entry-btn"', content)
        self.assertIn('id="dockReferenceBtn" class="btn-secondary sidebar-support-entry-btn"', content)
        self.assertIn('id="dockExportBtn" class="btn-secondary sidebar-support-entry-btn"', content)
        self.assertNotIn('id="dockEditPopoverBtn"', content)
        self.assertNotIn('id="presetClear"', content)

    def test_project_sidebar_order_matches_phase_02_contract(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        project_panel_start = content.index('id="projectSidebarPanel"')
        project_panel_end = content.index("</section>", project_panel_start)
        project_panel = content[project_panel_start:project_panel_end]
        order = [
            'id="projectLegendSection"',
            'id="frontlineProjectSection"',
            'id="exportProjectSection"',
            'id="inspectorUtilitiesSection"',
            'id="diagnosticsSection"',
        ]
        positions = [project_panel.index(token) for token in order]
        self.assertEqual(positions, sorted(positions))

    def test_toolbar_and_sidebar_write_url_contract_keys(self):
        toolbar = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")
        support_surface = (REPO_ROOT / "js" / "ui" / "toolbar" / "workspace_chrome_support_surface_controller.js").read_text(encoding="utf-8")
        url_state = (REPO_ROOT / "js" / "ui" / "ui_surface_url_state.js").read_text(encoding="utf-8")
        sidebar = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")
        self.assertIn("syncSupportSurfaceUrlState", toolbar)
        self.assertIn("createUiSurfaceUrlState", toolbar)
        self.assertIn("uiUrlStateKeys.view", url_state)
        self.assertIn("getSupportSurfaceViewFromUrl", support_surface)
        self.assertIn("syncRightSidebarUrlState", sidebar)
        self.assertIn("UI_URL_STATE_KEYS.scope", sidebar)
        self.assertIn("UI_URL_STATE_KEYS.section", sidebar)

    def test_sidebar_hands_export_view_restore_back_to_toolbar(self):
        sidebar = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")

        self.assertIn('if (viewValue === "export") {', sidebar)
        self.assertIn("exportDetails.open = true;", sidebar)
        self.assertIn('callRuntimeHook(state, "restoreSupportSurfaceFromUrlFn");', sidebar)


if __name__ == "__main__":
    unittest.main()
