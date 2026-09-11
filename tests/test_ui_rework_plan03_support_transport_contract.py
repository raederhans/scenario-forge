from pathlib import Path
import unittest

from tools.pages_artifact_root import resolve_pages_artifact_root

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)
RIVER_LAYER_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "river_layer_render_owner.js"


class UiReworkPlan03SupportTransportContractTest(unittest.TestCase):
    def test_agent_tiers_doc_exists_for_multi_agent_runs(self):
        content = (REPO_ROOT / "docs" / "shared" / "agent-tiers.md").read_text(encoding="utf-8")
        self.assertIn("## LOW", content)
        self.assertIn("## STANDARD", content)
        self.assertIn("## THOROUGH", content)
        self.assertIn("## 多代理启动前必看文件", content)
        self.assertIn("## 收尾前最低验证要求", content)
        self.assertIn("## 什么算真正收尾", content)

    def test_main_paths_no_longer_ship_old_inspector_summary_classes(self):
        index_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        self.assertNotIn("inspector-section-summary-copy", index_content)
        self.assertNotIn("class=\"section-header inspector-section-summary", index_content)
        self.assertNotIn(".inspector-section-summary {", css_content)
        self.assertNotIn(".inspector-section-summary-copy {", css_content)

    def test_support_surface_tool_panels_keep_help_copy_and_drop_export_tooltip(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        self.assertIn('id="scenarioGuideBackdrop"', content)
        self.assertIn('id="scenarioGuidePopover"', content)
        self.assertIn('id="scenarioGuideCloseBtn"', content)
        self.assertIn('id="scenarioGuideLanguageToggle"', content)
        self.assertIn("scenario-guide-title-row", content)
        self.assertIn("scenario-guide-modal", content)
        self.assertNotIn("scenarioGuideSupportHint", content)
        self.assertNotIn("scenarioGuideStatus", content)
        self.assertNotIn("scenarioGuideStatusChips", content)
        self.assertNotIn("Open this manual from the scenario bar or the Utilities panel. Both Guide buttons open the same help surface, so you can keep the next editing step visible while you work.", content)
        self.assertIn("Before editing, look at the chips at the top of the map.", content)
        self.assertIn("Mode shows the active tool, View shows the map state you are seeing, and Split shows how many countries have split ownership.", content)
        self.assertIn("Before a large edit or before loading another project, save a backup: open Project Management and download the current project JSON.", content)
        self.assertIn("After loading a project, check the Inspector again.", content)
        self.assertIn("Confirm the target country and active owner, then review frontlines, reference image alignment, and export settings.", content)
        self.assertNotIn("Save the current working state before you load a different project file.", content)
        self.assertNotIn("You can open Guide from the top scenario bar or from Project › Utilities.", content)
        self.assertIn("scenario-guide-tool-accordion", content)
        self.assertIn('class="scenario-guide-tool-panel" open', content)
        for token in [
            'id="scenarioGuideTabHgo"',
            'data-guide-section="hgo"',
            'id="scenarioGuideSectionHgo"',
            'data-guide-panel="hgo"',
            'id="scenarioGuideTabAppearance"',
            'data-guide-section="appearance"',
            'id="scenarioGuideSectionAppearance"',
            'data-guide-panel="appearance"',
            'id="scenarioGuideTabEditing"',
            'data-guide-section="editing"',
            'id="scenarioGuideSectionEditing"',
            'data-guide-panel="editing"',
            "HGO preview helps you inspect the HGO source layer beside the active scenario map.",
            "The Inspector can show HGO names, flag options, and ideology labels for the selected country.",
            "Appearance covers borders, ocean, rivers, city points, physical regions, day-night lighting, textures, and presets.",
            "Transport controls the overview layer for airports, ports, rail, and roads.",
            "Open Transport Workbench when you need pack preview, layer order, diagnostics, data rows, or apply-to-map controls.",
            "Scenario Actions, Quick Fill, special zones, frontlines, operational graphics, and unit counters",
        ]:
            self.assertIn(token, content)
        self.assertIn("Use Project tools as a publish checklist: save the project, add strategic context, align references, then export.", content)
        self.assertIn("Contains Download Project, Load Project, selected file status, and import safety checks.", content)
        self.assertIn("Contains derived frontlines, operational lines, operation graphics, and unit counters.", content)
        self.assertIn("Contains local image upload, opacity, scale, horizontal offset, and vertical offset controls.", content)
        self.assertIn("Contains target selection, format, export resolution, preview, layer order, text stacks, and image adjustments.", content)
        self.assertIn("Treat saving and exporting as two separate handoff steps: save the editable project first", content)
        self.assertIn("Project JSON save", content)
        self.assertIn("Use Download Project to save the current editable state: scenario choice, ownership edits, appearance, transport, strategic annotations, reference alignment values, and export settings.", content)
        self.assertIn("Export workflow", content)
        self.assertIn("Export creates the final image, per-layer PNG set, or bake pack; it does not replace the editable project JSON.", content)
        self.assertIn("Final handoff check", content)
        self.assertIn("keep one editable project JSON and one exported output from the same reviewed state", content)
        self.assertNotIn("Before publishing, confirm strategic annotations are present, map labels are readable", content)
        self.assertNotIn("For project handoff, save a project JSON, reload it once", content)
        self.assertNotIn("Reference: After you upload a local image, the most stable alignment order is opacity", content)
        self.assertNotIn("Export: Keep Strategic annotations enabled when you want frontlines, operational lines, graphics, and unit counters in the final image or bake pack.", content)
        self.assertNotIn("Frontlines & Annotations: Use derived frontlines for conflict edges, then add operational lines, graphics, and unit counters as strategic annotations for export.", content)
        self.assertNotIn("Use Guide for workflow steps and Reference for visual alignment. Both stay in the Project tab so you can check instructions without losing context.", content)
        self.assertNotIn("Use Frontline after you apply a scenario. This section combines", content)
        self.assertNotIn("lblExportInfoTooltip", content)
        for token in [
            "width: min(680px, calc(100vw - 32px));",
            ".scenario-guide-language-btn {",
            ".scenario-guide-tool-accordion {",
            ".scenario-guide-tool-summary {",
            ".scenario-guide-tool-summary::marker {",
            "grid-row: 1 / span 2;",
            "transform-origin: center;",
            ".scenario-guide-tool-title,",
            ".scenario-guide-tool-summary-copy {\n  grid-column: 1;",
            ".scenario-guide-tool-steps li {",
            "grid-template-columns: 74px minmax(0, 1fr);",
        ]:
            self.assertIn(token, css_content)
        for removed in [
            ".scenario-guide-status {",
            ".scenario-guide-status-chips {",
            ".scenario-guide-status-pill {",
        ]:
            self.assertNotIn(removed, css_content)

    def test_scenario_guide_new_sections_are_registered_in_source_dist_and_locales(self):
        source_index = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        dist_index = (PAGES_DIST_ROOT / "app" / "index.html").read_text(encoding="utf-8")
        source_controller = (REPO_ROOT / "js" / "ui" / "toolbar" / "scenario_guide_popover.js").read_text(encoding="utf-8")
        dist_controller = (PAGES_DIST_ROOT / "app" / "js" / "ui" / "toolbar" / "scenario_guide_popover.js").read_text(encoding="utf-8")
        source_locales = (REPO_ROOT / "data" / "locales.json").read_text(encoding="utf-8")
        dist_locales = (PAGES_DIST_ROOT / "app" / "data" / "locales.json").read_text(encoding="utf-8")

        for section in ['"hgo"', '"appearance"', '"editing"']:
            self.assertIn(section, source_controller)
            self.assertIn(section, dist_controller)

        for token in [
            'id="scenarioGuideTabHgo"',
            'id="scenarioGuideSectionHgo"',
            'id="scenarioGuideTabAppearance"',
            'id="scenarioGuideSectionAppearance"',
            'id="scenarioGuideTabEditing"',
            'id="scenarioGuideSectionEditing"',
            "HGO and identity",
            "Appearance and transport",
            "Editing tools",
        ]:
            self.assertIn(token, source_index)
            self.assertIn(token, dist_index)

        for locale_token in [
            '"HGO and identity"',
            '"HGO preview helps you inspect the HGO source layer beside the active scenario map. It is best used before ownership, label, or color decisions."',
            '"Appearance covers borders, ocean, rivers, city points, physical regions, day-night lighting, textures, and presets. These controls change how the same scenario reads on screen and in export."',
            '"Transport controls the overview layer for airports, ports, rail, and roads. The visual mode changes whether you read distribution, network shape, or coverage."',
            '"Scenario Actions, Quick Fill, special zones, frontlines, operational graphics, and unit counters help you move from single-country edits to a readable campaign map."',
            '"zh":',
        ]:
            self.assertIn(locale_token, source_locales)
            self.assertIn(locale_token, dist_locales)


    def test_left_sidebar_typography_and_redundant_copy_contract(self):
        index_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        controller_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_controls_controller.js").read_text(encoding="utf-8")
        toolbar_content = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")

        for token in [
            'id="scenarioStatus" class="body-text visually-hidden"',
            'id="scenarioAuditHint" class="body-text visually-hidden hidden"',
        ]:
            self.assertIn(token, index_content)

        for removed in [
            'id="appearanceLayerFilter"',
            'id="lblAppearanceFilter"',
            'id="lblTextureInfo"',
            'Apply a subtle overlay texture for a vintage map feel.',
            'id="appearanceTabOcean"',
            'id="appearanceTabLayers"',
            'id="appearanceTabDayNight"',
            'id="appearanceTabTexture"',
            'id="lblContextLayers"',
            'id="cityPointsPresetDensityGroupHint"',
            'id="cityPointsMarkerDensityHint"',
            'id="cityPointsLabelDensityHint"',
            'id="cityPointsAdvancedHint"',
        ]:
            self.assertNotIn(removed, index_content)

        for token in [
            "#leftSidebar {",
            "--left-panel-font-section: 0.86rem;",
            "--left-panel-font-control: 0.74rem;",
            "#leftSidebar .toggle-label,",
            "#leftSidebar .palette-library-title,",
            ".appearance-layer-tab-panel .appearance-subsection-stack,",
            "#mapContentStack > .map-content-panel,",
            "#mapContentStack > .appearance-mini-section {",
            "padding: 18px 20px 20px;",
            "#mapContentStack > .map-content-panel > .section-header,",
            "#mapContentStack > details.appearance-mini-section > summary.section-header {",
            "#mapContentStack > details.appearance-mini-section > summary.section-header::after,",
            "#mapContentStack > details.map-content-panel.appearance-mini-section {",
            "#leftSidebar .appearance-layer-tab-panel > .section-header {",
            'display: none;',
            '.appearance-layer-tab-panel .appearance-mini-section[data-promoted-layer-panel="true"] > summary.section-header {',
            "#mapContentStack .map-content-panel > .appearance-ocean-grid,",
            "#mapContentStack .rivers-panel,",
            "#appearancePanelTexture > .space-y-3",
            ".appearance-control-card {",
            "box-sizing: border-box;",
            "width: 100%;",
            ".appearance-ocean-grid {",
            ".appearance-day-night-stack {",
            ".appearance-layer-tab-panel .appearance-mini-section .ml-5,",
            "#mapContentStack .appearance-mini-section .ml-5 {",
            ".appearance-layer-tab-panel .appearance-mini-section .flex.items-center.justify-between.gap-3,",
            "#mapContentStack .map-content-panel .flex.items-center.justify-between.gap-3,",
            "#mapContentStack .appearance-mini-section .flex.items-center.justify-between.gap-3 {",
            "#appearancePanelTransport .transport-family-body .flex.items-center.justify-between.gap-3 {",
            "grid-template-columns: minmax(0, 1fr) minmax(96px, 1.35fr);",
            "#mapContentStack > details.map-content-panel.appearance-mini-section > .rivers-panel {",
            ".appearance-layer-tab-panel .appearance-prop-group .flex.items-center.justify-between.gap-2:has(> .sidebar-action-secondary + .sidebar-action-secondary),",
            "#mapContentStack .map-content-panel .appearance-prop-group .flex.items-center.justify-between.gap-2:has(> .sidebar-action-secondary + .sidebar-action-secondary),",
            "#mapContentStack .map-content-panel .flex.items-center.justify-between.gap-2:has(> .sidebar-action-secondary + .sidebar-action-secondary),",
            "#mapContentStack .appearance-prop-group .flex.items-center.justify-between.gap-2:has(> .sidebar-action-secondary + .sidebar-action-secondary) {",
            ".city-points-toggle-card,",
            ".rivers-toggle-card,",
            ".transport-family-body > section,",
            ".transport-family-section {",
        ]:
            self.assertIn(token, css_content)

        for token in [
            'class="appearance-control-card" aria-labelledby="lblOceanSurfaceCard"',
            'id="lblOceanStyleCard" class="appearance-control-card-title"',
            'id="lblOceanTextureCard" class="appearance-control-card-title"',
            'class="toggle-label appearance-day-night-card"',
            'id="dayNightManualControls" class="appearance-day-night-card"',
            'id="dayNightSyncComputerUtcBtn"',
            'id="cityPointsHelpTooltip" class="info-tooltip"',
            'id="lblCityPointsStyleGroup" class="appearance-control-card-title"',
            'id="lblCityPointsLabelGroup" class="appearance-control-card-title"',
            'class="appearance-control-card rivers-visibility-card" aria-labelledby="lblRiversVisibilityGroup"',
            'id="lblRiversVisibilityGroup" class="appearance-control-card-title" data-i18n="Visibility"',
            'id="lblRiversStrokeGroup" class="appearance-control-card-title"',
            'id="lblRiversOutlineGroup" class="appearance-control-card-title"',
            'class="toggle-label transport-master-toggle-card"',
        ]:
            self.assertIn(token, index_content)

        for token in [
            'id="labelMapContent" class="section-header" data-i18n="Map Content"',
            'class="appearance-tab-row map-content-tab-row"',
            'data-i18n-aria-label="Map content sections"',
            'id="mapContentTabOcean"',
            'data-map-content-tab="ocean"',
            'aria-controls="appearancePanelOcean"',
            'id="mapContentTabDayNight"',
            'data-map-content-tab="daynight"',
            'aria-controls="appearancePanelDayNight"',
            'id="mapContentTabTexture"',
            'data-map-content-tab="texture"',
            'aria-controls="appearancePanelTexture"',
            'id="mapContentTabRivers"',
            'data-map-content-tab="rivers"',
            'aria-controls="mapContentPanelRivers"',
            'id="mapContentStack" class="appearance-stack mt-4"',
            'id="appearancePanelOcean"\n                class="card-flat appearance-subsection map-content-panel"',
            'id="appearancePanelDayNight"\n                class="card-flat appearance-subsection map-content-panel"',
            'id="appearancePanelTexture"\n                class="card-flat appearance-subsection map-content-panel"',
            'id="mapContentPanelRivers" class="appearance-mini-section"',
            'id="appearancePanelLayers"\n                class="hidden"\n                hidden\n                aria-hidden="true"',
            'id="appearancePanelBorders"\n                class="card-flat appearance-subsection appearance-tab-panel is-active"',
            'id="appearanceTabPhysical"',
            'data-appearance-tab="physical"',
            'aria-controls="appearancePanelPhysical"',
            'id="appearanceTabUrban"',
            'data-appearance-tab="urban"',
            'aria-controls="appearancePanelUrban"',
            'id="appearanceTabCityPoints"',
            'data-appearance-tab="citypoints"',
            'aria-controls="appearancePanelCityPoints"',
            'id="appearancePanelPhysical"\n                class="card-flat appearance-subsection appearance-tab-panel appearance-layer-tab-panel"',
            'data-appearance-panel="physical"',
            'id="appearancePanelUrban"\n                class="card-flat appearance-subsection appearance-tab-panel appearance-layer-tab-panel"',
            'data-appearance-panel="urban"',
            'id="appearancePanelCityPoints"\n                class="card-flat appearance-subsection appearance-tab-panel appearance-layer-tab-panel"',
            'data-appearance-panel="citypoints"',
            'id="appearancePhysicalStack" class="appearance-subsection-stack mt-3"',
            'id="appearanceUrbanStack" class="appearance-subsection-stack mt-3"',
            'id="appearanceCityPointsStack" class="appearance-subsection-stack mt-3"',
        ]:
            self.assertIn(token, index_content)

        for token in [
            'moveAppearanceLayerPanel("lblPhysicalPanel", "appearancePhysicalStack");',
            'moveAppearanceLayerPanel("lblUrbanPanel", "appearanceUrbanStack");',
            'moveAppearanceLayerPanel("lblCityPointsPanel", "appearanceCityPointsStack");',
            'panel.setAttribute("data-promoted-layer-panel", "true");',
            'if (panel instanceof HTMLDetailsElement) panel.open = true;',
            'document.getElementById("appearancePanelOcean")',
            'document.getElementById("appearancePanelDayNight")',
            'document.getElementById("appearancePanelTexture")',
            'document.getElementById("lblRiversPanel")?.closest(".appearance-mini-section")',
            'panel.classList.add("card-flat", "appearance-subsection", "map-content-panel");',
            'panel.setAttribute("data-map-content-panel", tabId);',
            'panel.setAttribute("role", "tabpanel");',
            'panel.setAttribute("aria-labelledby", labelledBy);',
            'mapContentStack.appendChild(panel);',
            'const setMapContentTab = (tabId = "ocean") => {',
            'setMapContentTab("ocean");',
            'const setAppearanceTab = (tabId = "borders") => {',
        ]:
            self.assertIn(token, controller_content)

        self.assertIn('setAppearanceTabController("borders");', toolbar_content)
        self.assertNotIn('setAppearanceTabController("ocean");', toolbar_content)

    def test_city_runtime_e2e_uses_current_appearance_and_map_content_tabs(self):
        city_runtime_content = (
            REPO_ROOT / "tests" / "e2e" / "city_points_urban_runtime.spec.js"
        ).read_text(encoding="utf-8")

        for token in [
            'activatePanelTab(page, "appearanceTabCityPoints", "appearancePanelCityPoints")',
            'activatePanelTab(page, "mapContentTabDayNight", "appearancePanelDayNight")',
        ]:
            self.assertIn(token, city_runtime_content)

        for stale_token in [
            '"appearanceTabLayers"',
            '"appearanceTabDayNight"',
        ]:
            self.assertNotIn(stale_token, city_runtime_content)

    def test_river_dash_style_applies_to_outline_and_core_strokes(self):
        owner_content = RIVER_LAYER_RENDER_OWNER_JS.read_text(encoding="utf-8")
        self.assertIn("const resolvedDashPattern = dashPattern.map((value) => value / scale);", owner_content)
        self.assertGreaterEqual(owner_content.count("context.setLineDash(resolvedDashPattern);"), 2)
        self.assertIn('dashStyle: String(cfg.dashStyle || "solid"),', owner_content)
        self.assertIn("dashPattern: resolvedDashPattern,", owner_content)

    def test_layer_status_indicators_share_dot_and_tone_contract(self):
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        dist_css_content = (PAGES_DIST_ROOT / "app" / "css" / "style.css").read_text(encoding="utf-8")
        diagnostics_content = (
            REPO_ROOT / "js" / "ui" / "toolbar" / "layer_status_diagnostics.js"
        ).read_text(encoding="utf-8")
        appearance_controller_content = (
            REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_controls_controller.js"
        ).read_text(encoding="utf-8")
        thematic_controller_content = (
            REPO_ROOT / "js" / "ui" / "toolbar" / "thematic_layer_preview_controller.js"
        ).read_text(encoding="utf-8")

        for content in (css_content, dist_css_content):
            for token in [
                ".layer-status-strip {",
                "display: flex;",
                "align-items: center;",
                "gap: 7px;",
                "margin: 6px 0 10px;",
                "font-weight: 600;",
                ".layer-status-strip::before {",
                "flex: 0 0 7px;",
                ".layer-status-strip[data-status-tone=\"active\"]::before {",
                ".layer-status-strip[data-status-tone=\"warning\"]::before,",
                ".layer-status-strip[data-status-tone=\"pending\"]::before {",
                ".layer-status-strip[data-status-tone=\"disabled\"] {",
                ".layer-status-strip[data-status-tone=\"disabled\"]::before {",
                ".appearance-control-card-title + .layer-status-strip,",
                ".section-header + .layer-status-strip {",
                "margin-top: 6px;",
            ]:
                self.assertIn(token, content)

        for token in [
            "const STATUS_TONE = Object.freeze({",
            "export function resolveLayerStatusTone",
            "if (diagnostic?.enabled === false || diagnostic?.supported === false) return STATUS_TONE.DISABLED;",
            'loadStatus: status || (layerCount > 0 ? "loaded" : "pending"),',
        ]:
            self.assertIn(token, diagnostics_content)

        self.assertIn("node.dataset.statusTone = resolveLayerStatusTone(diagnostic, severity);", appearance_controller_content)
        self.assertIn('node.dataset.statusTone = "muted";', appearance_controller_content)
        self.assertIn("node.dataset.statusTone = resolveLayerStatusTone(diagnostic, normalizedSeverity);", thematic_controller_content)

    def test_transport_shell_uses_phase03_titles_and_status_contract(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        required_tokens = [
            'id="transportWorkbenchInfoTitle" class="transport-workbench-info-title" data-i18n="Transport guide"',
            'class="transport-workbench-column-kicker" data-i18n="Lens">Lens',
            'class="transport-workbench-column-kicker" data-i18n="Inspector">Inspector',
            'id="transportWorkbenchInspectorEmptyTitle" class="transport-workbench-empty-title" data-i18n="No transport schema loaded yet"',
        ]
        for token in required_tokens:
            self.assertIn(token, content)
        self.assertNotIn("transportWorkbenchPreviewActions", content)
        self.assertNotIn("transportWorkbenchCompareBtn", content)
        self.assertNotIn("transportWorkbenchCompareStatus", content)

    def test_appearance_transport_visual_mode_dom_and_controller_contract(self):
        index_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        controller_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_appearance_controller.js").read_text(encoding="utf-8")
        state_defaults_content = (REPO_ROOT / "js" / "core" / "state_defaults.js").read_text(encoding="utf-8")
        registry_content = (REPO_ROOT / "js" / "core" / "transport_capability_registry.js").read_text(encoding="utf-8")

        for token in [
            'id="transportVisualModeControls" class="appearance-control-card transport-visual-mode-card" aria-labelledby="lblTransportVisualMode"',
            'class="toggle-label transport-master-toggle-card"',
            'id="transportAppearanceMasterToggle" type="checkbox" class="checkbox-input"',
            'id="lblTransportVisualMode" class="range-label" for="transportVisualMode" data-i18n="Transport Visual Mode"',
            'id="transportVisualMode" class="select-input mt-2"',
            'id="optTransportVisualModeDistribution" value="distribution" selected data-i18n="Distribution"',
            'id="optTransportVisualModeNetwork" value="network" data-i18n="Network"',
            'id="optTransportVisualModeCoverage" value="coverage" data-i18n="Coverage"',
        ]:
            self.assertIn(token, index_content)
        self.assertNotIn("transportVisualModeHint", index_content)

        for token in [
            "#appearancePanelTransport .transport-visual-mode-card #transportVisualMode {",
            "appearance: none;",
            "background-image: var(--app-select-chevron-muted);",
            "background-position: right 11px center;",
            "#appearancePanelTransport .transport-visual-mode-card #transportVisualMode:focus-visible {",
            "#appearancePanelTransport .transport-visual-mode-card #transportVisualMode:disabled {",
        ]:
            self.assertIn(token, css_content)

        for token in [
            'const transportVisualMode = document.getElementById("transportVisualMode");',
            'const getTransportAppearanceVisualMode = () => normalizeTransportOverviewVisualMode(',
            'if (transportVisualMode) transportVisualMode.value = visualMode;',
            'if (transportVisualMode) transportVisualMode.disabled = !transportEnabled;',
            'transportVisualMode.addEventListener("change", (event) => {',
            'getTransportAppearanceConfig().visualMode = normalizeTransportOverviewVisualMode(',
            'renderTransportAppearanceDirty("transport-visual-mode");',
        ]:
            self.assertIn(token, controller_content)

        self.assertIn('visualMode: "distribution",', state_defaults_content)
        self.assertIn('visualMode: normalizeTransportOverviewVisualMode(source.visualMode, "distribution"),', state_defaults_content)
        self.assertIn('TRANSPORT_OVERVIEW_VISUAL_MODES = Object.freeze(["distribution", "network", "coverage"])', registry_content)

    def test_appearance_transport_summary_reports_class_source_and_phase(self):
        index_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        controller_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_appearance_controller.js").read_text(encoding="utf-8")
        summary_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_transport_summary.js").read_text(encoding="utf-8")
        registry_content = (REPO_ROOT / "js" / "core" / "transport_capability_registry.js").read_text(encoding="utf-8")
        i18n_content = (REPO_ROOT / "js" / "core" / "i18n_catalog.js").read_text(encoding="utf-8")

        for token in [
            'id="roadLabelsEnabled"',
            'id="roadLabelDensity"',
            'data-i18n="Road labels use segment ref/name when present."',
        ]:
            self.assertIn(token, index_content)

        for token in [
            'from "./appearance_transport_summary.js";',
            'buildTransportFamilySummaryTextForState',
            'formatTransportPercent',
            'formatTransportScopeLabel',
            'formatTransportThresholdLabel',
        ]:
            self.assertIn(token, controller_content)

        for token in [
            'metrics,',
            "const metrics = metricsSource && typeof metricsSource === \"object\" ? metricsSource : {};",
            'metrics.contextBreakdown',
            'getTransportOverviewLineSummaryMeta',
            'getTransportLineClassCoverage',
            'formatTransportPercent',
            'formatTransportScopeLabel',
            'formatTransportThresholdLabel',
            'primary/secondary pending',
            'secondary full-only',
        ]:
            self.assertIn(token, summary_content)

        for token in [
            'TRANSPORT_OVERVIEW_LINE_SUMMARY_META',
            'ref sidecar Phase B',
            'major stations Phase B',
            'checked-in Overture',
        ]:
            self.assertIn(token, registry_content)

        for token in [
            '"Loaded classes:"',
            '"Phase:"',
            '"Source:"',
            '"checked-in Overture"',
            '"Road labels use segment ref/name when present."',
        ]:
            self.assertIn(token, i18n_content)

    def test_toolbar_drops_legacy_transport_info_renderer_and_uses_new_copy(self):
        toolbar_content = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")
        controller_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_controller.js").read_text(encoding="utf-8")
        shell_owner_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "transport_workbench_shell_owner.js").read_text(encoding="utf-8")
        self.assertNotIn("renderTransportWorkbenchInfoPopoverLegacy", toolbar_content)
        self.assertIn("inspectorTitle,", shell_owner_content)
        self.assertIn('syncTextContent(inspectorTitle, `${translate(family.label)} ${translate("inspector")}`)', shell_owner_content)
        self.assertIn("transportWorkbenchShellOwner.render(context);", controller_content)
        self.assertNotIn("transportWorkbenchCompareBtn", toolbar_content)
        self.assertNotIn("transportWorkbenchCompareStatus", toolbar_content)
        self.assertNotIn("transportWorkbenchCompareStatus.textContent", controller_content)

    def test_toolbar_language_toggle_displays_current_language_state(self):
        toolbar_content = (REPO_ROOT / "js" / "ui" / "toolbar.js").read_text(encoding="utf-8")
        self.assertIn('const scenarioGuideLanguageToggle = document.getElementById("scenarioGuideLanguageToggle");', toolbar_content)
        self.assertIn('const currentLangLabel = runtimeState.currentLanguage === "zh" ? "ZH" : "EN";', toolbar_content)
        self.assertIn("[toggleLang, scenarioGuideLanguageToggle].forEach((button) => {", toolbar_content)
        self.assertIn("button.textContent = currentLangLabel;", toolbar_content)
        self.assertIn("button.setAttribute(\"title\", `${t(\"Language\", \"ui\")}: ${currentLangLabel}`);", toolbar_content)
        self.assertIn("scenarioGuideLanguageToggle.addEventListener(\"click\", toggleLanguage);", toolbar_content)
        self.assertIn("renderSpecialZoneEditorUI();\n    updateLanguageToggleUi();", toolbar_content)
        self.assertIn("updateUIText();\n  updateLanguageToggleUi();", toolbar_content)
        self.assertNotIn('"ZH / EN"', toolbar_content)
        self.assertNotIn('"EN / ZH"', toolbar_content)

    def test_adaptive_popover_and_palette_contracts_are_wired(self):
        index_content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        css_content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        palette_content = (REPO_ROOT / "js" / "ui" / "toolbar" / "palette_library_panel.js").read_text(encoding="utf-8")
        sidebar_content = (REPO_ROOT / "js" / "ui" / "sidebar.js").read_text(encoding="utf-8")

        for token in [
            'id="paletteLibraryList" class="palette-library-list mt-3 u-scroll-y"',
            'id="transportWorkbenchInfoPopover" class="transport-workbench-info-popover u-scroll-y hidden"',
            'id="transportWorkbenchSectionHelpPopover" class="transport-workbench-section-help-popover u-scroll-y hidden"',
        ]:
            self.assertIn(token, index_content)

        for token in [
            "width: var(--layout-popover-inline);",
            "max-block-size: var(--layout-popover-block);",
            "height: auto;",
            "max-height: var(--palette-library-list-max-block);",
        ]:
            self.assertIn(token, css_content)

        self.assertIn('readPaletteLibraryBlockSize("--palette-library-list-max-block"', palette_content)
        self.assertIn('paletteLibraryList.style.height = "auto";', palette_content)
        self.assertIn("resolveAdaptivePaletteLibraryHeight(scrollHeight, maximumHeight)", palette_content)
        self.assertIn('title.className = "palette-library-title u-truncate";', palette_content)
        self.assertIn('fileName.className = "project-file-name u-truncate";',
                      (REPO_ROOT / "js" / "ui" / "sidebar" / "project_support_diagnostics_controller.js").read_text(encoding="utf-8"))

        for token in [
            "#projectLegendSection,",
            "#legendProjectSection,",
            "#frontlineProjectSection,",
            "#transportProjectSection,",
            "#exportProjectSection,",
            "#inspectorUtilitiesSection,",
            "#diagnosticsSection {",
            ".frontline-tab-card {",
            "border-radius: 18px;",
            ".strategic-accordion-section {",
            "border-radius: 15px;",
            ".strategic-accordion-body {",
            "max-height: min(52vh, 460px);",
            "scrollbar-gutter: stable;",
        ]:
            self.assertIn(token, css_content)

        for token in [
            't("Project-local lines, graphics, and unit counters for export.", "ui")',
            't("Plan lines.", "ui")',
            't("Arrows and markers.", "ui")',
            't("Map pieces.", "ui")',
        ]:
            self.assertIn(token, sidebar_content)
        self.assertNotIn("Operation graphics and unit counters stay in the same frontline workspace", sidebar_content)
        self.assertNotIn("Counters should read like map pieces first", sidebar_content)


if __name__ == "__main__":
    unittest.main()
