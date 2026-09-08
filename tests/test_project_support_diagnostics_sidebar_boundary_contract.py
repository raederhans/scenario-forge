from pathlib import Path
import re
import unittest

from tools.pages_artifact_root import resolve_pages_artifact_root

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "project_support_diagnostics_controller.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"
INTERACTION_FUNNEL_UI_SYNC_JS = REPO_ROOT / "js" / "core" / "interaction_funnel" / "ui_sync.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
STYLE_CSS = REPO_ROOT / "css" / "style.css"
CORE_I18N_JS = REPO_ROOT / "js" / "core" / "i18n.js"
CORE_I18N_CATALOG_JS = REPO_ROOT / "js" / "core" / "i18n_catalog.js"
UI_I18N_JS = REPO_ROOT / "js" / "ui" / "i18n.js"
UI_I18N_CATALOG_JS = REPO_ROOT / "js" / "ui" / "i18n_catalog.js"
FILE_MANAGER_JS = REPO_ROOT / "js" / "core" / "file_manager.js"
PROJECT_PACKAGE_IO_JS = REPO_ROOT / "js" / "core" / "project_package_io.js"


class ProjectSupportDiagnosticsSidebarBoundaryContractTest(unittest.TestCase):
    # 这组静态合同锁 sidebar facade 与 controller owner 的边界；
    # DOM 与事件由 controller 拥有；runtime hook 注册留在 sidebar facade。
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
        self.assertIn('scenarioAuditSection.className = "inspector-tool-card scenario-audit-panel";', owner_content)
        self.assertIsNone(re.search(r"const\s+renderScenarioAuditPanel\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+refreshLegendEditor\s*=\s*\(\)\s*=>", sidebar_content))

    def test_sidebar_passes_hosts_without_project_leaf_injection(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")
        wiring = sidebar_content.split("} = createProjectSupportDiagnosticsController({", 1)[1].split("  }));", 1)[0]
        self.assertIn("hosts: {", wiring)
        for host in ["projectManagementStack", "legendEditorStack", "diagnosticStack", "rightSidebarContent"]:
            self.assertIn(f"{host},", wiring)
        self.assertNotIn("elements:", wiring)
        for node_id in ["projectManagement", "legendEditor", "scenarioAuditPanel", "debugViewControl", "projectFileName", "backendAccountPopover", "debug-mode-select"]:
            self.assertNotIn(f'document.getElementById("{node_id}")', sidebar_content)
            self.assertIn(f'documentRef.getElementById("{node_id}")', owner_content)
        self.assertNotIn("projectFileName", sidebar_content)

    def test_scenario_audit_panel_has_overflow_safe_visual_contract(self):
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")
        css_content = STYLE_CSS.read_text(encoding="utf-8")

        for token in [
            'row.className = "scenario-audit-row";',
            'left.className = "inspector-mini-label scenario-audit-label";',
            'right.className = "country-row-title scenario-audit-value";',
            'list.className = "mt-2 flex flex-col gap-2 scenario-audit-list";',
            'row.className = "scenario-audit-row scenario-audit-check-row";',
            'className: "body-text scenario-audit-key",',
            'className: "inspector-mini-label scenario-audit-status",',
            'details.className = "inspector-preset-details scenario-audit-check-details";',
            'summary.className = "inspector-accordion-btn scenario-audit-check-summary";',
        ]:
            self.assertIn(token, owner_content)

        for token in [
            "#scenarioAuditPanel {",
            "  overflow: hidden;",
            ".scenario-audit-row {",
            "grid-template-columns: minmax(0, 1fr) minmax(0, 9ch);",
            ".scenario-audit-value,",
            ".scenario-audit-status {",
            "text-overflow: ellipsis;",
            ".scenario-audit-key,",
            ".scenario-audit-check-summary {",
            "overflow-wrap: anywhere;",
        ]:
            self.assertIn(token, css_content)

    def test_sidebar_keeps_project_support_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('bindEvents: bindProjectSupportDiagnosticsEvents,', content)
        self.assertIn('refreshLegendEditor,', content)
        self.assertIn('renderScenarioAuditPanel,', content)
        self.assertIn('bindProjectSupportDiagnosticsEvents();', content)
        self.assertIn('registerRuntimeHook(state, "renderScenarioAuditPanelFn", renderScenarioAuditPanel);', content)
        self.assertIn('registerRuntimeHook(state, "updateLegendUI", refreshLegendEditor);', content)
        self.assertGreater(
            content.index('registerRuntimeHook(state, "renderScenarioAuditPanelFn", renderScenarioAuditPanel);'),
            content.index('bindProjectSupportDiagnosticsEvents();')
        )

    def test_project_support_release_surface_matches_source(self):
        pairs = [
            (SIDEBAR_JS, PAGES_DIST_ROOT / "app" / "js" / "ui" / "sidebar.js"),
            (
                PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS,
                PAGES_DIST_ROOT / "app" / "js" / "ui" / "sidebar" / "project_support_diagnostics_controller.js",
            ),
            (CORE_I18N_JS, PAGES_DIST_ROOT / "app" / "js" / "core" / "i18n.js"),
            (CORE_I18N_CATALOG_JS, PAGES_DIST_ROOT / "app" / "js" / "core" / "i18n_catalog.js"),
            (UI_I18N_JS, PAGES_DIST_ROOT / "app" / "js" / "ui" / "i18n.js"),
            (UI_I18N_CATALOG_JS, PAGES_DIST_ROOT / "app" / "js" / "ui" / "i18n_catalog.js"),
            (FILE_MANAGER_JS, PAGES_DIST_ROOT / "app" / "js" / "core" / "file_manager.js"),
            (PROJECT_PACKAGE_IO_JS, PAGES_DIST_ROOT / "app" / "js" / "core" / "project_package_io.js"),
        ]

        for source_path, dist_path in pairs:
            with self.subTest(source=source_path.name):
                self.assertEqual(
                    source_path.read_text(encoding="utf-8"),
                    dist_path.read_text(encoding="utf-8"),
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
        self.assertIn("refreshProjectSaveStatus", owner_content)

    def test_controller_keeps_project_import_and_legend_helpers(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('legendManager: LegendManager,', sidebar_content)
        self.assertIn('fileManager: FileManager,', sidebar_content)
        self.assertIn('importProjectThroughFunnel,', sidebar_content)
        self.assertIn('invalidateFrontlineOverlayState: () => invalidateFrontlineOverlayState(),', sidebar_content)
        self.assertIn('legendManager.getUniqueColors(state)', owner_content)
        self.assertIn('legendManager.getSpecialZoneLayers(state)', owner_content)
        self.assertIn('legendManager.getSpecialZoneSignature(state)', owner_content)
        self.assertIn('fileManager.exportProject(state, {', owner_content)
        self.assertIn('destination: projectDownloadDestination?.value || "picker"', owner_content)
        self.assertIn('const projectDownloadFormat = documentRef.getElementById("projectDownloadFormat");', owner_content)
        self.assertIn('const projectDownloadDestination = documentRef.getElementById("projectDownloadDestination");', owner_content)
        self.assertIn('["picker", "Save As dialog"]', owner_content)
        self.assertIn('["browser", "Browser download"]', owner_content)
        self.assertIn('const projectLoadSource = documentRef.getElementById("projectLoadSource");', owner_content)
        self.assertIn('const projectSaveStatus = documentRef.getElementById("projectSaveStatus");', owner_content)
        self.assertIn('const backendCloudStatus = documentRef.getElementById("backendCloudStatus");', owner_content)
        self.assertIn('accountShelf.id = "rightSidebarAccountShelf";', owner_content)
        self.assertIn('accountShelf.append(accountDock);', owner_content)
        self.assertIn('documentRef.body.append(accountBackdrop, accountPopover);', owner_content)
        self.assertIn('rightSidebarContent?.appendChild(accountShelf);', owner_content)
        self.assertNotIn('actions.appendChild(accountDock);', owner_content)
        self.assertIn('accountToggleBtn.id = "backendAccountToggleBtn";', owner_content)
        self.assertIn('accountPopover.id = "backendAccountPopover";', owner_content)
        self.assertIn('cloudSection.id = "backendCloudSection";', owner_content)
        self.assertIn('cloudSection.hidden = true;', owner_content)
        self.assertIn('accountPopover.appendChild(cloudSection);', owner_content)
        self.assertIn('const backendCloudSection = documentRef.getElementById("backendCloudSection");', owner_content)
        self.assertIn('setBackendAccountPopoverOpen', owner_content)
        self.assertIn('backendCloudSaveBtn,', owner_content)
        self.assertIn('setBackendCloudSessionState("anonymous")', owner_content)
        self.assertIn('setBackendCloudSessionState("authenticated")', owner_content)
        self.assertIn('createBackendSave({', owner_content)
        self.assertIn('const saveId = await resolveLatestCloudSaveId();', owner_content)
        self.assertIn('publishBackendSave(saveId)', owner_content)
        self.assertIn('listBackendSaves()', owner_content)
        self.assertIn('listCommunitySaves()', owner_content)
        self.assertIn('downloadCommunitySave(saveId)', owner_content)
        self.assertIn('refreshProjectSaveStatus,', sidebar_content)
        self.assertIn('registerRuntimeHook(state, "updateProjectSaveStatusFn", refreshProjectSaveStatus);', sidebar_content)
        self.assertIn('updateProjectSaveStatusFn: "sidebar:update-project-save-status"', (REPO_ROOT / "js" / "core" / "state" / "config.js").read_text(encoding="utf-8"))
        self.assertIn('callRuntimeHook(runtimeState, "updateProjectSaveStatusFn");', (REPO_ROOT / "js" / "core" / "dirty_state.js").read_text(encoding="utf-8"))
        self.assertIn('projectSaveStatus.classList.add("hidden");', owner_content)
        self.assertIn('projectSaveStatus.textContent = "";', owner_content)
        self.assertIn('Project export includes appearance and transport settings.', owner_content)
        self.assertIn('Project exported. Appearance and transport settings are saved in the selected project file.', owner_content)
        self.assertIn('onProjectImportComplete: completeProjectImportStatus', owner_content)
        self.assertIn('onProjectImportError: failProjectImportStatus', owner_content)
        self.assertIn('importProjectThroughFunnel(file, {', owner_content)
        self.assertIn('invalidateFrontlineOverlayState,', owner_content)

    def test_generated_legend_preserves_map_color_state_and_uses_dynamic_list_height(self):
        owner_content = PROJECT_SUPPORT_DIAGNOSTICS_CONTROLLER_JS.read_text(encoding="utf-8")
        css_content = STYLE_CSS.read_text(encoding="utf-8")

        self.assertIn('legendManager.applyGeneratedLegend(state, generation);', owner_content)
        self.assertIn('appState.legendColorOrder = colorOrder;', (REPO_ROOT / "js" / "core" / "legend_manager.js").read_text(encoding="utf-8"))
        self.assertIn('mapRenderer.renderLegend(legendManager.getUniqueColors(state), legendManager.getLabels(state));', owner_content)
        self.assertIn('legendList.style.setProperty("--legend-editor-dynamic-max-height"', owner_content)
        self.assertNotIn('markLegacyColorStateDirty();', owner_content)
        self.assertNotIn('mapRenderer.refreshColorState({ renderNow: true });', owner_content)
        self.assertIn('max-height: min(68vh, var(--legend-editor-dynamic-max-height, 360px));', css_content)

    def test_interaction_funnel_and_renderer_keep_project_support_callbacks(self):
        interaction_funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        interaction_funnel_ui_sync_content = INTERACTION_FUNNEL_UI_SYNC_JS.read_text(encoding="utf-8")
        map_renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn('syncProjectImportUiStateHelper', interaction_funnel_content)
        self.assertIn("onProjectImportComplete", interaction_funnel_content)
        self.assertIn("onSuccess: () => hooks.onProjectImportComplete?.(importSummary)", interaction_funnel_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_LEGEND_UI);', interaction_funnel_ui_sync_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.RENDER_SCENARIO_AUDIT_PANEL);', interaction_funnel_ui_sync_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TRANSPORT_APPEARANCE_UI);', interaction_funnel_ui_sync_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.CLEAR_REFERENCE_IMAGE, { markDirty: false });', interaction_funnel_ui_sync_content)
        self.assertIn('runtimeState.updateLegendUI();', map_renderer_content)


if __name__ == "__main__":
    unittest.main()
