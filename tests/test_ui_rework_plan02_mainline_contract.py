from pathlib import Path
import re
import unittest

from tools.pages_artifact_root import resolve_pages_artifact_root

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)


class UiReworkPlan02MainlineContractTest(unittest.TestCase):
    def test_transport_moves_to_project_sidebar_and_leaves_top_rails(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        scenario_bar_start = content.index('<div id="scenarioContextBar"')
        scenario_bar_end = content.index('<div id="toastViewport"', scenario_bar_start)
        scenario_bar = content[scenario_bar_start:scenario_bar_end]
        self.assertIn('id="scenarioGuideBtn"', scenario_bar)
        self.assertNotIn('id="scenarioTransportWorkbenchBtn"', scenario_bar)

        zoom_controls_start = content.index('<div id="zoomControls"')
        zoom_controls_end = content.index('<section id="bottomDock"', zoom_controls_start)
        zoom_controls = content[zoom_controls_start:zoom_controls_end]
        self.assertNotIn('id="scenarioTransportWorkbenchBtn"', zoom_controls)
        self.assertIn('id="zoomUtilityWorkspaceGroup" class="shell-utility-group shell-utility-group-workspace hidden"', zoom_controls)
        self.assertIn('aria-hidden="true"', zoom_controls)

        project_panel_start = content.index('id="projectSidebarPanel"')
        project_panel_end = content.index("</aside>", project_panel_start)
        project_panel = content[project_panel_start:project_panel_end]
        transport_start = project_panel.index('id="transportProjectSection"')
        transport_end = project_panel.index('id="exportProjectSection"', transport_start)
        transport_section = project_panel[transport_start:transport_end]
        self.assertIn('id="scenarioTransportWorkbenchBtn"', transport_section)
        self.assertIn('class="btn-secondary sidebar-support-entry-btn"', transport_section)
        self.assertIn('aria-haspopup="dialog"', transport_section)
        self.assertIn('aria-controls="transportWorkbenchOverlay"', transport_section)
        self.assertIn('aria-expanded="false"', transport_section)
        self.assertIn('data-transport-entry-label="Open workbench"', transport_section)

    def test_support_entries_are_text_buttons_and_dock_drops_long_config_and_clear(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="utilitiesGuideBtn" class="btn-secondary sidebar-support-entry-btn"', content)
        self.assertIn('id="dockReferenceBtn" class="btn-secondary sidebar-support-entry-btn"', content)
        self.assertIn('id="dockExportBtn" class="btn-secondary sidebar-support-entry-btn"', content)
        self.assertNotIn('id="dockEditPopoverBtn"', content)
        self.assertNotIn('id="presetClear"', content)
        self.assertNotIn("Preview layers, format, and resolution before export.", content)

    def test_project_sidebar_order_matches_phase_02_contract(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        project_panel_start = content.index('id="projectSidebarPanel"')
        project_panel_end = content.index("</aside>", project_panel_start)
        project_panel = content[project_panel_start:project_panel_end]
        order = [
            'id="projectLegendSection"',
            'id="legendProjectSection"',
            'id="frontlineProjectSection"',
            'id="transportProjectSection"',
            'id="exportProjectSection"',
            'id="inspectorUtilitiesSection"',
            'id="diagnosticsSection"',
        ]
        positions = [project_panel.index(token) for token in order]
        self.assertEqual(positions, sorted(positions))

    def test_legend_editor_uses_outer_section_heading_only(self):
        sidebar = (REPO_ROOT / "js" / "ui" / "sidebar" / "project_support_diagnostics_controller.js").read_text(encoding="utf-8")

        self.assertIn('list.id = "legendEditorList";', sidebar)
        self.assertNotIn('title.id = "lblLegendEditor";', sidebar)
        self.assertNotIn('title.textContent = t("Legend Editor", "ui");', sidebar)

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

    def test_scenario_inspector_layout_keeps_global_sections_unforced(self):
        sidebar = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")
        function_start = sidebar.index("  const updateScenarioInspectorLayout = () => {")
        function_end = sidebar.index("  const INSPECTOR_VH_BASELINE =", function_start)
        function_body = sidebar[function_start:function_end]

        self.assertIn('const scenarioDefaultsKey = String(runtimeState.activeScenarioId || "__base__");', function_body)
        scenario_defaults_gate = re.compile(
            r"if \(scenarioDefaultsKey !== lastScenarioInspectorDefaultsKey\) \{\s*"
            r"collapseScenarioManagedSections\(\);\s*"
            r"lastScenarioInspectorDefaultsKey = scenarioDefaultsKey;\s*"
            r"\}",
            re.S,
        )
        self.assertRegex(function_body, scenario_defaults_gate)
        for assignment in [
            "projectLegendSection.open =",
            "legendProjectSection.open =",
            "diagnosticsSection.open =",
        ]:
            self.assertNotIn(assignment, function_body)

    def test_dev_workspace_top_entry_stays_hidden_under_developer_button(self):
        toolbar = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")

        for token in [
            'const zoomUtilityWorkspaceGroup = document.getElementById("zoomUtilityWorkspaceGroup");',
            'zoomUtilityWorkspaceGroup?.classList.add("hidden");',
            'zoomUtilityWorkspaceGroup?.setAttribute("aria-hidden", "true");',
            'devWorkspaceToggleBtn?.classList.add("hidden");',
            'devWorkspaceToggleBtn?.setAttribute("aria-hidden", "true");',
            'devWorkspaceToggleBtn?.setAttribute("tabindex", "-1");',
            'callRuntimeHook(state, "setDevWorkspaceExpandedFn", true);',
        ]:
            self.assertIn(token, toolbar)

    def test_sidebar_transport_entry_tests_use_real_details_clicks(self):
        for relative_path in [
            "tests/e2e/transport_phase_b_main_map_smoke.spec.js",
            "tests/e2e/ui_rework_mainline_shell_sidebar.spec.js",
            "tests/e2e/ui_rework_support_transport_hardening.spec.js",
            "tests/e2e/transport_workbench_industrial_variants.spec.js",
            "tests/e2e/transport_workbench_label_rotation.spec.js",
            "tests/e2e/transport_workbench_port_coverage_tiers.spec.js",
        ]:
            content = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
            self.assertIn('page.locator("#lblTransportProject").click()', content)
            self.assertIn('toHaveJSProperty("open", true)', content)
            self.assertNotIn("transport.open = true", content)

    def test_sidebar_keeps_preset_batch_out_of_production_console_log(self):
        for relative_path in [
            "js/ui/sidebar.js",
            "dist/app/js/ui/sidebar.js",
        ]:
            content = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
            self.assertNotIn('console.log(`Applied preset "', content)
            self.assertNotIn('Applied preset "', content)

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

    def test_right_sidebar_has_smooth_collapse_handle(self):
        html_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        dist_css_content = (PAGES_DIST_ROOT / "app" / "css" / "style.css").read_text(encoding="utf-8")
        sidebar_content = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")

        for token in [
            'id="rightSidebarCollapseBtn"',
            'class="right-sidebar-collapse-btn"',
            'aria-controls="rightSidebarContent"',
            'id="rightSidebarContent" class="sidebar-sections inspector-sidebar-sections"',
        ]:
            self.assertIn(token, html_content)

        for token in [
            ".sidebar-right > .sidebar-sections {",
            "overflow-y: auto;",
            ".right-sidebar-collapse-btn {",
            "top: 50%;",
            "@media (min-width: 1024px) {",
            "body.right-sidebar-collapsed .sidebar-right {",
            "flex-basis: 0;",
            "body.right-sidebar-collapsed .sidebar-right > .sidebar-sections {",
            "pointer-events: none;",
            "@media (prefers-reduced-motion: reduce) {",
        ]:
            self.assertIn(token, css_content)

        for content in (css_content, dist_css_content):
            self.assertNotIn(":has(#selectedCountryActionsSection[open] .inspector-action-disclosure[open])", content)
            self.assertNotIn("width: 328px;", content)

        for token in [
            "@media (min-width: 1024px) {",
            "body.right-sidebar-collapsed .sidebar-right {",
            "flex: 0 0 288px;",
            "max-width: 288px;",
            "@media (max-width: 1023px) {",
            "body.right-drawer-open .sidebar-right {",
            ".panel-toggle-right {",
        ]:
            self.assertIn(token, dist_css_content)

        for token in [
            'const RIGHT_SIDEBAR_COLLAPSED_KEY = "map_right_sidebar_collapsed";',
            "const rightSidebarCollapseMedia = typeof globalThis.matchMedia === \"function\"",
            'globalThis.matchMedia("(min-width: 1024px)")',
            "rightSidebarContent?.toggleAttribute(\"inert\", effectiveCollapsed);",
            'rightSidebarCollapseBtn?.setAttribute("data-i18n-aria-label", nextSidebarLabel);',
            'const SIDEBAR_LAYOUT_START_EVENT = "mapcreator:sidebar-layout-start";',
            'const SIDEBAR_LAYOUT_REFRESH_EVENT = "mapcreator:sidebar-layout-refresh";',
            "globalThis.dispatchEvent(new CustomEvent(SIDEBAR_LAYOUT_REFRESH_EVENT));",
            "rightSidebarCollapseBtn.addEventListener(\"click\"",
        ]:
            self.assertIn(token, sidebar_content)

    def test_left_sidebar_has_smooth_collapse_handle(self):
        html_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        sidebar_content = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")

        for token in [
            'id="leftSidebarCollapseBtn"',
            'class="left-sidebar-collapse-btn"',
            'aria-controls="leftSidebarContent"',
            'id="leftSidebarContent" class="sidebar-sections"',
        ]:
            self.assertIn(token, html_content)

        for token in [
            ".sidebar > .sidebar-sections {",
            "overflow-y: auto;",
            ".left-sidebar-collapse-btn {",
            "right: 0;",
            "body.left-sidebar-collapsed .sidebar-left {",
            "flex-basis: 0;",
            "body.left-sidebar-collapsed .sidebar-left > .sidebar-sections {",
            "pointer-events: none;",
            "transform: translateX(-18px);",
            "body.left-sidebar-collapsed .left-sidebar-collapse-btn {",
            "transform: translate(calc(100% + 10px), -50%);",
        ]:
            self.assertIn(token, css_content)

        for token in [
            'const LEFT_SIDEBAR_COLLAPSED_KEY = "map_left_sidebar_collapsed";',
            "const leftSidebarCollapseMedia = typeof globalThis.matchMedia === \"function\"",
            "leftSidebarContent?.toggleAttribute(\"inert\", effectiveCollapsed);",
            'leftSidebarCollapseBtn?.setAttribute("data-i18n-aria-label", nextSidebarLabel);',
            "beginCollapsedSidebarLayout();",
            "requestLeftSidebarLayoutRefresh();",
            "leftSidebarCollapseBtn.addEventListener(\"click\"",
        ]:
            self.assertIn(token, sidebar_content)

        toolbar_content = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")
        scenario_context_bar_content = (
            REPO_ROOT / "js" / "ui" / "toolbar" / "scenario_context_bar_controller.js"
        ).read_text(encoding="utf-8")
        for token in [
            "const bindResponsiveChromeLayout = () => {",
            "const refreshResponsiveChromeLayout = () => {",
            'globalRef.addEventListener("resize", refreshResponsiveChromeLayout);',
            'globalRef.addEventListener("mapcreator:sidebar-layout-refresh", refreshResponsiveChromeLayout);',
            "refreshScenarioContextBar();",
            "handlePaletteLibraryResize();",
        ]:
            self.assertIn(token, scenario_context_bar_content)

        for token in [
            "bindResponsiveChromeLayout,",
            "bindResponsiveChromeLayout();",
            "refreshScenarioContextBar();",
        ]:
            self.assertIn(token, toolbar_content)

    def test_physical_atlas_classes_are_visually_grouped_without_nested_containers(self):
        html_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")

        atlas_start = html_content.index('id="lblTerrainAtlasPanel"')
        atlas_end = html_content.index('id="lblTerrainContoursPanel"', atlas_start)
        atlas_markup = html_content[atlas_start:atlas_end]
        ordered_ids = [
            "physicalClassMountain",
            "physicalClassMountainHills",
            "physicalClassPlateau",
            "physicalClassBadlands",
            "physicalClassPlains",
            "physicalClassBasin",
            "physicalClassWetlands",
            "physicalClassForestTemperate",
            "physicalClassRainforestTropical",
            "physicalClassGrassland",
            "physicalClassDesert",
            "physicalClassTundra",
        ]
        positions = [atlas_markup.index(f'id="{control_id}"') for control_id in ordered_ids]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(atlas_markup.count("physical-atlas-group-start"), 2)
        self.assertIn('class="toggle-label physical-atlas-group-start">\n                                  <input id="physicalClassPlains"', atlas_markup)
        self.assertIn('class="toggle-label physical-atlas-group-start">\n                                  <input id="physicalClassForestTemperate"', atlas_markup)
        self.assertIn("#leftSidebar .physical-atlas-group-start {", css_content)
        self.assertIn("border-top: 1px solid rgba(37, 54, 73, 0.1);", css_content)

    def test_bottom_dock_adaptive_owner_wraps_groups_and_uses_container_queries(self):
        content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        required_tokens = [
            "container-type: inline-size;",
            "--layout-dock-inline: min(860px, calc(100% - 2 * var(--layout-edge)));",
            "width: var(--layout-dock-inline);",
            "flex-direction: row;",
            ".bottom-dock-primary {\n  width: 100%;\n  display: flex;\n  flex-wrap: wrap;",
            "@container (max-width: 720px)",
            "grid-template-columns: repeat(2, minmax(0, 1fr));",
            "@container (max-width: 420px)",
            "grid-template-columns: 1fr;",
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_collapsed_bottom_dock_anchors_to_handle_side(self):
        content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        self.assertIn(
            ".bottom-dock.is-collapsed {\n"
            "  left: auto;\n"
            "  right: 22px;",
            content,
        )
        self.assertIn("  overflow: hidden;\n  contain: layout paint;", content)
        self.assertIn(
            ".bottom-dock.is-collapsed > :not(#bottomDockHeading):not(.dock-handle-btn):not(.dev-workspace-quickbar),",
            content,
        )
        self.assertIn(
            "  .bottom-dock.is-collapsed {\n"
            "    left: auto;\n"
            "    right: 14px;",
            content,
        )

    def test_country_inspector_hierarchy_uses_polished_compact_stack(self):
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        sidebar_content = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")
        sidebar_content += (REPO_ROOT / "js" / "ui" / "sidebar" / "scenario_inspector_controller.js").read_text(encoding="utf-8")
        water_special_content = (REPO_ROOT / "js" / "ui" / "sidebar" / "water_special_region_controller.js").read_text(encoding="utf-8")

        for token in [
            "#countryInspectorSection,",
            "#specialRegionInspectorSection,",
            "#waterInspectorSection,",
            "border-radius: 18px;",
            "#countryList > .country-explorer-group:not(.country-select-card)",
            "scrollbar-gutter: stable;",
            "#countryList.inspector-scroll",
            "max-height: 34vh;",
            "linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(239, 244, 249, 0.82))",
            ".inspector-action-disclosure-body {",
            "max-height: min(34vh, 320px);",
            ".inspector-action-list-natural {",
            "max-height: min(34vh, 320px);",
            ".scenario-visual-adjustments-body {",
            "#selectedCountryActionsSection > .inspector-panel-body {",
            "min-height: auto;",
            "max-height: min(54vh, 520px);",
            "#selectedCountryActionsSection.has-open-visual-adjustments[open] {",
            "max-height: min(76vh, 720px);",
            "#selectedCountryActionsSection.has-open-visual-adjustments > .inspector-panel-body {",
            "max-height: min(66vh, 640px);",
            "#selectedCountryActionsSection.is-empty-selection-panel > .inspector-panel-body {",
            "min-height: 0;",
            "--inspector-font-card-title: 0.78rem;",
            "--inspector-font-control: 0.74rem;",
            "font-size: var(--inspector-font-control);",
            "font-size: var(--inspector-font-card-title, 0.78rem);",
            "#specialRegionInspectorSection .toggle-label,",
            "#waterInspectorSection .select-input {",
            ".country-children-meta {",
            "grid-column: 1 / -1;",
            "flex-wrap: nowrap;",
            ".country-children-meta-copy {",
            "flex: 1 1 auto;",
            ".country-children-meta-label {",
            "white-space: nowrap;",
            "text-overflow: ellipsis;",
            ".country-children-toggle {",
            "flex: 0 0 auto;",
            "#specialRegionInspectorSection.is-empty-scenario-panel .inspector-panel-body {",
            "#selectedCountryActionsSection #presetTree.inspector-scroll {",
            "overflow: visible;",
            "scrollbar-gutter: stable;",
            "#waterRegionList.inspector-scroll {",
            "scroll-snap-type: y proximity;",
            "#waterRegionList .inspector-item-btn {",
            "scroll-snap-align: start;",
            ".water-filter-card-head {",
            ".water-filter-controls {",
            ".water-filter-field {",
            "grid-template-columns: minmax(38px, 0.42fr) minmax(0, 1fr);",
            "#waterInspectorSection .water-filter-field .select-input {",
            "min-height: 32px;",
        ]:
            self.assertIn(token, css_content)

        for token in [
            "countryListCompactCap: 34",
            "countryListCap: 42",
            "presetTreeCompactCap: 48",
            "selectedActionsBodyCompactCap: 54",
            "selectedActionsBodyVisualOpenCap: 66",
            "selectedActionsBodyVisualOpenCompactCap: 64",
            "selectedActionsBodyReserve: 28",
            "const isScenarioVisualAdjustmentsExpanded = () => (",
            "const getCountryInspectorListCap = () => {",
            "const getSelectedActionsBodyCap = () => {",
            '"has-open-visual-adjustments"',
            "selectedCountryActionsSection?.open",
            "releaseAdaptiveInspectorHeight(presetTree);",
            'element.style.height = "";',
            'element.style.maxHeight = "";',
            "const isSelectedActionsEmptyState = () => (",
            'selectedCountryActionsSection?.classList.contains("is-empty-selection-panel")',
            "releaseAdaptiveInspectorHeight(selectedCountryActionsBody);",
            'selectedCountryActionsSection?.classList.toggle("is-empty-selection-panel", !countryState);',
            "toViewportPixels(getCountryInspectorListCap())",
            "toViewportPixels(getSelectedActionsBodyCap())",
            'container.appendChild(createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui")));',
            'presetTree.appendChild(createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui")));',
        ]:
            self.assertIn(token, sidebar_content)

        for token in [
            'childrenMeta.className = "country-children-meta";',
            'metaCopy.className = "country-children-meta-copy";',
            'countLabel.className = "country-children-meta-label";',
            'countLabel.textContent = t("Related Countries", "ui");',
            "renderCountrySelectRow(childList, childState, {",
            "showRelationMeta: false,",
            'toggleBtn.setAttribute("aria-expanded", String(isExpanded));',
            "showRelationMeta: !!group.parentState?.releasable,",
        ]:
            self.assertIn(token, (REPO_ROOT / "js" / "ui" / "sidebar" / "country_inspector_controller.js").read_text(encoding="utf-8"))

        for token in [
            "const renderScenarioRelatedCountryGroups = (container, countryState) => {",
            't("Related Governments", "ui")',
            "appendScenarioChildCountryRows(section, subjectChildren);",
            "appendScenarioChildCountryRows(section, releasableChildren);",
        ]:
            self.assertIn(token, sidebar_content)
        self.assertLess(
            sidebar_content.index('element.style.height = "";'),
            sidebar_content.index("const scrollHeight = Number(element.scrollHeight || 0);"),
        )
        preset_controller = (REPO_ROOT / "js" / "ui" / "sidebar" / "regional_preset_controller.js").read_text(encoding="utf-8")
        self.assertLess(preset_controller.index("if (!entries.length) return;"),
                        preset_controller.index('appendActionSection(container, t("Regional Presets (Visual Color)"'))
        self.assertNotIn('createEmptyNote(t("No regional presets", "ui"))', preset_controller)
        for token in [
            "buildPaletteColorSuggestionsForCountry,",
            "ensurePaletteAssetsLoaded,",
            "setInspectorFeatureHighlight,",
            "function previewHierarchyGroupHighlight(group, featureIds = []) {",
            "setInspectorFeatureHighlight(matchedIds, {",
            "groupMode: true,",
            "previewHierarchyGroupHighlight(group, targetIds);",
            'suggestionSelect.className = "inspector-color-suggestion-select";',
            'suggestionSelect.setAttribute("aria-label", t("Palette color suggestions", "ui"));',
            'currentOption.textContent = t("Current country color", "ui");',
            'currentOption.textContent = t("Loading palette suggestions", "ui");',
            "void loadPaletteColorSuggestionsForCountry(countryState).then((suggestions) => {",
            "const getLocalizedPaletteSuggestionLabel = (suggestion, countryState = null) => {",
            "const getLocalizedPaletteSuggestionPaletteLabel = (suggestion) => {",
            "const formatPaletteColorSuggestionText = (suggestion, countryState = null, { includeColor = false } = {}) => {",
            'String(countryState?.displayName || "").trim()',
            "option.textContent = formatPaletteColorSuggestionText(suggestion, countryState, { includeColor: true });",
            "applyPaletteColorSuggestion(suggestion, compactButton);",
        ]:
            self.assertIn(token, sidebar_content)
        palette_manager_content = (REPO_ROOT / "js" / "core" / "palette_manager.js").read_text(encoding="utf-8")
        for token in [
            "function collectCountryPaletteMatchTargets(countryState = {}) {",
            "function buildPaletteColorSuggestionsForCountry(",
            'matchKind: "iso2"',
            'matchKind: "tag"',
            'matchKind: "name"',
            "buildPaletteColorSuggestionsForCountry,",
        ]:
            self.assertIn(token, palette_manager_content)
        locales_content = (REPO_ROOT / "data" / "locales.json").read_text(encoding="utf-8")
        self.assertIn('"Country Color": {\n      "en": "Country Color",\n      "zh": "国家配色"', locales_content)
        self.assertIn('"Palette color suggestions": {', locales_content)
        self.assertIn('"Current country color": {', locales_content)
        i18n_catalog_content = (REPO_ROOT / "js" / "core" / "i18n_catalog.js").read_text(encoding="utf-8")
        for token in [
            '"Country Color": { zh: "国家配色", en: "Country Color" }',
            '"Current country color": { zh: "当前国家颜色", en: "Current country color" }',
            '"Palette color suggestions": { zh: "色板颜色建议", en: "Palette color suggestions" }',
            'Presets: { zh: "预设", en: "Presets" }',
            'Kaiserreich: { zh: "凯撒帝国", en: "Kaiserreich" }',
        ]:
            self.assertIn(token, i18n_catalog_content)
        self.assertNotIn('appendActionSection(container, t("Notes", "ui"))', sidebar_content)
        self.assertNotIn('appendActionSection(container, t("Navigation", "ui"))', sidebar_content)

        self.assertIn("#countryInspectorColorRow {", css_content)
        self.assertIn("#countryList .country-select-row button:hover", css_content)
        self.assertIn("#specialRegionInspectorSection .inspector-detail-section", css_content)
        self.assertIn(".inspector-color-suggestion-select {", css_content)
        self.assertIn(".inspector-color-sync-row-compact .inspector-color-sync-copy {", css_content)
        for token in [
            "const hasVisibleSpecialRegions = hasActiveScenario && getVisibleSpecialFeatures().length > 0;",
            "!!runtimeState.showScenarioReliefOverlays",
            'specialRegionInspectorSection.classList.toggle("hidden", !hasActiveScenario);',
            'specialRegionInspectorSection.classList.toggle("is-empty-scenario-panel", hasActiveScenario && !hasScenarioInspectorContent);',
        ]:
            self.assertIn(token, water_special_content)
        self.assertIn("#projectLegendSection,", css_content)
        self.assertIn("#legendProjectSection,", css_content)
        self.assertIn("#transportProjectSection,", css_content)
        self.assertIn("#inspectorUtilitiesSection,", css_content)
        self.assertIn("#diagnosticsSection {", css_content)
        self.assertIn(".project-file-option .select-input {", css_content)
        self.assertIn("appearance: none;", css_content)
        self.assertIn(".project-file-option .select-input:hover {", css_content)
        self.assertIn(".project-file-option .select-input:focus {", css_content)

    def test_special_zone_workbench_uses_sidebar_visual_contract(self):
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")

        for token in [
            ".special-zone-layers-workbench {\n  display: flex;",
            "  margin-top: 12px;",
            "  background: transparent;",
            ".special-zone-workbench-card {\n  display: grid;",
            "border: 1px solid rgba(37, 54, 73, 0.08);",
            "border-radius: 12px;",
            ".special-zone-layers-workbench .secondary-btn,",
            ".special-zone-layers-workbench .danger-btn {",
            ".special-zone-member-drawer .secondary-btn {",
            "font-size: var(--left-panel-font-control, 0.74rem);",
            ".special-zone-layer-row {\n  padding: 6px;",
            ".special-zone-workbench-field input[type=\"text\"],",
            ".special-zone-member-list > summary,",
            ".special-zone-member-chip:hover,",
        ]:
            self.assertIn(token, css_content)

    def test_native_selects_share_app_dropdown_chrome(self):
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        deferred_ui_bootstrap_content = (
            REPO_ROOT / "js" / "bootstrap" / "deferred_ui_bootstrap.js"
        ).read_text(encoding="utf-8")
        styled_selects_content = (REPO_ROOT / "js" / "ui" / "styled_selects.js").read_text(encoding="utf-8")
        special_zones_content = (
            REPO_ROOT / "js" / "ui" / "toolbar" / "special_zones_workbench_controller.js"
        ).read_text(encoding="utf-8")

        for token in [
            "select.select-input,",
            ".legend-generator-select,",
            ".transport-workbench-pack-select,",
            ".inspector-color-suggestion-select,",
            ".hgo-identity-variant-select,",
            ".special-zone-workbench-field select,",
            ".special-zone-workbench-card select {",
            "  appearance: none;",
            "  -webkit-appearance: none;",
            "  border-radius: 12px;",
            "  background-image: var(--app-select-chevron-muted);",
            ".app-select-shell {",
            ".app-select-button {",
            ".app-select-menu {",
            ".app-select-option {",
            "  font-size: 0.75rem;",
            "  font-weight: 600;",
            "  position: fixed;",
            "  top: var(--app-select-menu-top, 0);",
            "  left: var(--app-select-menu-left, 0);",
            "  width: var(--app-select-menu-width, 100%);",
            "  max-height: var(--app-select-menu-max-height, 220px);",
            "select:hover:not(:disabled),",
            "select:focus-visible,",
            "select:disabled,",
        ]:
            self.assertIn(token, css_content)

        for token in [
            ".legend-generator-select {\n",
            "  background-color: #fff;",
            ".transport-workbench-pack-select {\n",
            "  background-color: rgba(255, 255, 255, 0.62);",
            "#debug-mode-select.debug-select {\n",
            "  background-color: #fff8cc;",
            ".inspector-color-suggestion-select {\n",
            "  background-color: rgba(255, 255, 255, 0.86);",
            ".hgo-identity-variant-select {\n",
            "  font-weight: 650;",
            ".special-zone-workbench-field select,\n.special-zone-workbench-card select {\n  padding-right: 32px;",
        ]:
            self.assertIn(token, css_content)

        self.assertNotIn("linear-gradient(45deg, transparent 50%, var(--text-secondary) 50%)", css_content)
        self.assertNotIn(
            "linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 252, 0.88)),\n"
            "    url(\"data:image/svg+xml,%3Csvg",
            css_content,
        )
        for token in [
            "const ENHANCED_SELECT_SELECTOR = [",
            "const MENU_VIEWPORT_GAP = 8;",
            "function positionSurfaceMenu(surface) {",
            'surface.menu.style.setProperty("--app-select-menu-left"',
            'surface.menu.style.setProperty("--app-select-menu-top"',
            'surface.menu.style.setProperty("--app-select-menu-width"',
            'surface.menu.style.setProperty("--app-select-menu-max-height"',
            "spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= spaceAbove",
            "positionSurfaceMenu(surface);",
            "\"select.select-input\",",
            "\"select.transport-workbench-pack-select\",",
            "\".special-zone-workbench-field select\",",
            "select.dispatchEvent(new Event(\"change\", { bubbles: true }));",
            "observer.observe(document.body, {",
            'document.addEventListener("scroll", () => {',
            "export function initStyledSelects(root = document) {",
        ]:
            self.assertIn(token, styled_selects_content)
        for token in [
            '{ initStyledSelects },',
            '"../ui/styled_selects.js",',
            "initStyledSelects();",
        ]:
            self.assertIn(token, deferred_ui_bootstrap_content)
        special_zone_select_block_start = css_content.index(
            '.special-zone-workbench-field input[type="text"],\n'
            '.special-zone-workbench-field input[type="number"],\n'
            ".special-zone-workbench-field select,\n"
            ".special-zone-workbench-card select {"
        )
        special_zone_select_block_end = css_content.index("}", special_zone_select_block_start)
        special_zone_select_block = css_content[special_zone_select_block_start:special_zone_select_block_end]
        self.assertIn("border-radius: 12px;", special_zone_select_block)
        self.assertNotIn("background: #fff8cc;", css_content)
        self.assertIn(
            'setSourceSelect.className = "select-input special-zone-member-set-select";',
            special_zones_content,
        )


if __name__ == "__main__":
    unittest.main()
