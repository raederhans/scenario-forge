from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
STRATEGIC_OVERLAY_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "strategic_overlay_controller.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"


class StrategicOverlaySidebarBoundaryContractTest(unittest.TestCase):
    def test_sidebar_imports_strategic_overlay_controller(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('import { createStrategicOverlayController } from "./sidebar/strategic_overlay_controller.js";', content)
        self.assertIn('createStrategicOverlayController', content)

    def test_strategic_overlay_owner_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('export function createStrategicOverlayController({', owner_content)
        self.assertIn('const STRATEGIC_OVERLAY_REFRESH_SCOPES = Object.freeze([', owner_content)
        self.assertIn('const ensureStrategicOverlayUiState = () => {', owner_content)
        self.assertIn('const invalidateFrontlineOverlayState = () => {', owner_content)
        self.assertIn('const refreshFrontlineTabUI = () => {', owner_content)
        self.assertIn('const setStrategicWorkspaceModalState = (nextOpen, section = "line") => {', owner_content)
        self.assertIn('const refreshStrategicOverlayUI = ({ scopes = "all" } = {}) => {', owner_content)
        self.assertIn('const bindEvents = () => {', owner_content)
        self.assertIsNone(re.search(r"const\s+ensureStrategicOverlayUiState\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+invalidateFrontlineOverlayState\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+refreshFrontlineTabUI\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r'const\s+setStrategicWorkspaceModalState\s*=\s*\(nextOpen, section = "line"\)\s*=>', sidebar_content))

    def test_sidebar_keeps_strategic_overlay_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('bindEvents: bindStrategicOverlayEvents,', content)
        self.assertIn('closeCounterEditorModal,', content)
        self.assertIn('closeWorkspace: closeStrategicWorkspace,', content)
        self.assertIn('cancelEditingModes: cancelStrategicEditingModes,', content)
        self.assertIn('getPerfCounters: getStrategicOverlayPerfCounters,', content)
        self.assertIn('invalidateFrontlineOverlayState,', content)
        self.assertIn('refreshUI: refreshStrategicOverlayUI,', content)
        self.assertIn('bindStrategicOverlayEvents();', content)
        self.assertIn('state.updateStrategicOverlayUIFn = refreshStrategicOverlayUI;', content)
        self.assertIn('state.getStrategicOverlayPerfCountersFn = getStrategicOverlayPerfCounters;', content)

    def test_sidebar_keeps_strategic_overlay_dom_surface_and_import_hook(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        for token in [
            'frontlineOverlayPanel',
            'strategicOverlayPanel',
            'strategicCommandBar',
            'strategicOverlayOpenWorkspaceBtn',
            'strategicOverlayCloseWorkspaceBtn',
            'strategicOverlayIconCloseBtn',
            'unitCounterEditorModalOverlay',
        ]:
            self.assertIn(token, content)
        self.assertIn('invalidateFrontlineOverlayState,', content)
        self.assertIn('importProjectThroughFunnel(', content)

    def test_controller_keeps_refresh_scopes_and_runtime_tokens(self):
        content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")

        for token in [
            '"frontlineControls"',
            '"operationalLines"',
            '"operationGraphics"',
            '"counterIdentity"',
            '"counterCombat"',
            '"counterPreview"',
            '"counterCatalog"',
            '"counterList"',
            '"badgeCounts"',
            '"workspaceChrome"',
            'section === "counter" ? "counter" : "line"',
            'counterCatalogSource || "internal"',
            '=== "hoi4"',
            'counterCatalogSource === nextSource',
        ]:
            self.assertIn(token, content)

    def test_controller_keeps_hoi4_catalog_filter_helper_injection(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("getHoi4CatalogFilterOptions,", sidebar_content)
        self.assertIn("getHoi4CatalogFilterOptions,", owner_content)
        self.assertIn("getHoi4CatalogFilterOptions(effectivePresetId)", owner_content)

    def test_sidebar_keeps_hoi4_manifest_refresh_callback_bridge(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("const requestStrategicOverlayCatalogRefresh = () => {", content)
        self.assertIn('state.updateStrategicOverlayUIFn({ scopes: ["counterCatalog"] });', content)
        self.assertIn("requestStrategicOverlayCatalogRefresh();", content)

    def test_renderer_and_import_funnel_keep_state_callback_contract(self):
        map_renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        interaction_funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")

        self.assertIn('typeof state.updateStrategicOverlayUIFn === "function"', map_renderer_content)
        self.assertIn("state.updateStrategicOverlayUIFn();", map_renderer_content)
        self.assertIn('typeof state.updateStrategicOverlayUIFn === "function"', interaction_funnel_content)
        self.assertIn("state.updateStrategicOverlayUIFn();", interaction_funnel_content)


if __name__ == "__main__":
    unittest.main()
