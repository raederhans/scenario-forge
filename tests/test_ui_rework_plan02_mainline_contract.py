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

    def test_adaptive_layout_markup_contracts_are_wired(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        required_tokens = [
            'id="scenarioContextScenarioText" class="u-truncate"',
            'id="scenarioContextModeText" class="u-truncate"',
            'id="scenarioContextActiveText" class="u-truncate"',
            'id="scenarioContextSelectionText" class="u-truncate"',
            '<section id="bottomDock" class="bottom-dock"',
            '<div class="bottom-dock-primary">',
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_bottom_dock_adaptive_owner_uses_grid_and_container_queries(self):
        content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        required_tokens = [
            "container-type: inline-size;",
            "--layout-dock-inline: min(860px, calc(100% - 2 * var(--layout-edge)));",
            "width: var(--layout-dock-inline);",
            "flex-direction: row;",
            "grid-template-columns: auto auto auto minmax(220px, 1fr);",
            "@container (max-width: 720px)",
            "grid-template-columns: repeat(2, minmax(0, 1fr));",
            "@container (max-width: 420px)",
            "grid-template-columns: 1fr;",
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_country_inspector_hierarchy_uses_polished_compact_stack(self):
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        sidebar_content = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")

        for token in [
            "#countryInspectorSection,",
            "#specialRegionInspectorSection,",
            "#waterInspectorSection,",
            "border-radius: 18px;",
            "#countryList > .country-explorer-group:not(.country-select-card)",
            "scrollbar-gutter: stable;",
            "#countryList.inspector-scroll",
            "max-height: 30vh;",
            "linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(239, 244, 249, 0.82))",
            ".inspector-action-disclosure-body {",
            "max-height: min(34vh, 320px);",
            ".inspector-action-list-natural {",
            "max-height: min(34vh, 320px);",
            ".scenario-visual-adjustments-body {",
            "#selectedCountryActionsSection > .inspector-panel-body {",
            "max-height: min(54vh, 520px);",
            "--inspector-font-card-title: 0.78rem;",
            "--inspector-font-control: 0.74rem;",
            "font-size: var(--inspector-font-control);",
            "font-size: var(--inspector-font-card-title, 0.78rem);",
            "#selectedCountryActionsSection #presetTree.inspector-scroll {",
            "overflow: visible;",
            "scrollbar-gutter: stable;",
        ]:
            self.assertIn(token, css_content)

        for token in [
            "countryListCompactCap: 30",
            "presetTreeCompactCap: 48",
            "selectedActionsBodyCompactCap: 54",
            "const getCountryInspectorListCap = () => {",
            "const getSelectedActionsBodyCap = () => (",
            "selectedCountryActionsSection?.open",
            "releaseAdaptiveInspectorHeight(presetTree);",
            "toViewportPixels(getCountryInspectorListCap())",
            "toViewportPixels(getSelectedActionsBodyCap())",
        ]:
            self.assertIn(token, sidebar_content)

        for token in [
            "const renderScenarioRelatedCountryGroups = (container, countryState) => {",
            't("Related Governments", "ui")',
            "appendScenarioChildCountryRows(section, subjectChildren);",
            "appendScenarioChildCountryRows(section, releasableChildren);",
        ]:
            self.assertIn(token, sidebar_content)
        self.assertNotIn('appendActionSection(container, t("Notes", "ui"))', sidebar_content)
        self.assertNotIn('appendActionSection(container, t("Navigation", "ui"))', sidebar_content)

        self.assertIn("#countryInspectorColorRow {", css_content)
        self.assertIn("#countryList .country-select-row button:hover", css_content)
        self.assertIn("#specialRegionInspectorSection .inspector-detail-section", css_content)
        self.assertIn("#projectLegendSection,", css_content)
        self.assertIn("#inspectorUtilitiesSection,", css_content)
        self.assertIn("#diagnosticsSection {", css_content)


if __name__ == "__main__":
    unittest.main()
