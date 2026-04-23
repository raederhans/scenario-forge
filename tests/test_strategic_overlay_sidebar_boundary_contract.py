from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
STRATEGIC_OVERLAY_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "strategic_overlay_controller.js"
UNIT_COUNTER_BIND_EVENTS_HELPER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "strategic_overlay" / "unit_counter_bind_events_helper.js"
UNIT_COUNTER_MODAL_HELPER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "strategic_overlay" / "unit_counter_modal_helper.js"
UNIT_COUNTER_CATALOG_HELPER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "strategic_overlay" / "unit_counter_catalog_helper.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"
INTERACTION_FUNNEL_UI_SYNC_JS = REPO_ROOT / "js" / "core" / "interaction_funnel" / "ui_sync.js"


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
        self.assertIn('registerRuntimeHook(state, "updateStrategicOverlayUIFn", refreshStrategicOverlayUI);', content)
        self.assertIn('registerRuntimeHook(state, "getStrategicOverlayPerfCountersFn", getStrategicOverlayPerfCounters);', content)
        self.assertIn('document.body.classList.toggle("frontline-mode-active", activeId === "project");', content)
        self.assertIn('scopes: ["workspaceChrome", "counterIdentity", "counterPreview", "counterList"]', content)

    def test_sidebar_keeps_strategic_overlay_dom_surface_and_frontline_invalidation_hook(self):
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

    def test_controller_keeps_counter_modal_focus_return_to_toggle(self):
        controller_content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")
        helper_content = UNIT_COUNTER_MODAL_HELPER_JS.read_text(encoding="utf-8")

        self.assertIn('import { setUnitCounterEditorModalState } from "./strategic_overlay/unit_counter_modal_helper.js";', controller_content)
        self.assertIn("export function focusUnitCounterDetailToggle(toggleButton", helper_content)
        self.assertIn("toggleButton.focus({ preventScroll: true });", helper_content)
        self.assertIn("return documentRef.activeElement === toggleButton;", helper_content)
        self.assertIn("const previousFocused = uiState.counterEditorModalPreviouslyFocused;", helper_content)
        self.assertIn("uiState.counterEditorModalPreviouslyFocused = null;", helper_content)
        self.assertIn("if (focusUnitCounterDetailToggle(unitCounterDetailToggleBtn, { documentRef })) {", helper_content)

    def test_controller_keeps_refresh_scopes_and_runtime_tokens(self):
        content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")
        catalog_helper_content = UNIT_COUNTER_CATALOG_HELPER_JS.read_text(encoding="utf-8")

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
        ]:
            self.assertIn(token, content)
        self.assertIn('state.strategicOverlayUi.counterCatalogSource === normalizedSource', catalog_helper_content)

    def test_unit_counter_bind_events_owner_moves_to_helper(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        controller_content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")
        helper_content = UNIT_COUNTER_BIND_EVENTS_HELPER_JS.read_text(encoding="utf-8")
        catalog_helper_content = UNIT_COUNTER_CATALOG_HELPER_JS.read_text(encoding="utf-8")

        self.assertIn("getHoi4CatalogFilterOptions,", sidebar_content)
        self.assertIn('import { bindUnitCounterSidebarEvents } from "./strategic_overlay/unit_counter_bind_events_helper.js";', controller_content)
        self.assertIn("bindUnitCounterSidebarEvents({", controller_content)
        self.assertIn("helpers: {", controller_content)
        self.assertIn("export function bindUnitCounterSidebarEvents({", helper_content)
        self.assertIn("const syncUnitCounterCombatStateToSelection = (partial = {}, { commitSelected = true } = {}) => {", helper_content)
        self.assertIn('scheduleStrategicOverlayRefresh(["counterCombat", "counterPreview"]);', helper_content)
        self.assertIn('import {\n  applyUnitCounterCatalogReviewAction,', helper_content)
        self.assertIn('import { getCounterEditorModalFocusableElements } from "./unit_counter_modal_helper.js";', helper_content)
        self.assertIn("getHoi4CatalogFilterOptions,", catalog_helper_content)
        self.assertIn("getHoi4CatalogFilterOptions(effectivePresetId)", catalog_helper_content)
        self.assertIsNone(re.search(r"const\s+syncUnitCounterCombatStateToSelection\s*=\s*\(partial = \{\}, \{ commitSelected = true \} = \{\}\)\s*=>", controller_content))
        self.assertIsNone(re.search(r"const\s+applyUnitCounterCombatPreset\s*=\s*\(presetId, \{ source = \"preset\" \} = \{\}\)\s*=>", controller_content))

    def test_sidebar_keeps_hoi4_manifest_refresh_callback_bridge(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("const requestStrategicOverlayCatalogRefresh = () => {", content)
        self.assertIn('callRuntimeHook(state, "updateStrategicOverlayUIFn", { scopes: ["counterCatalog"] });', content)
        self.assertIn("requestStrategicOverlayCatalogRefresh();", content)

    def test_renderer_and_import_funnel_keep_state_callback_contract(self):
        map_renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        interaction_funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        interaction_funnel_ui_sync_content = INTERACTION_FUNNEL_UI_SYNC_JS.read_text(encoding="utf-8")

        self.assertIn('typeof runtimeState.updateStrategicOverlayUIFn === "function"', map_renderer_content)
        self.assertIn("runtimeState.updateStrategicOverlayUIFn();", map_renderer_content)
        self.assertIn('syncProjectImportUiStateHelper', interaction_funnel_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_STRATEGIC_OVERLAY_UI);', interaction_funnel_ui_sync_content)


if __name__ == "__main__":
    unittest.main()
