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
        navigation = content.split('const setRightSidebarTab = (tabId) => {', 1)[1].split('\n  };', 1)[0]
        self.assertNotIn('classList.toggle("frontline-mode-active"', navigation)
        self.assertIn('setStrategicMode: (active) => {', content)
        self.assertIn('document.body.classList.toggle("frontline-mode-active", active);', content)
        self.assertIn('scopes: ["workspaceChrome", "counterIdentity", "counterPreview", "counterList"]', content)

    def test_sidebar_keeps_strategic_overlay_dom_surface_and_frontline_invalidation_hook(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        for token in [
            'frontlineOverlayPanel',
            'strategicOverlayPanel',
            'strategicOverlayPublishStatus',
            'strategicCommandBar',
            'strategicOverlayOpenWorkspaceBtn',
            'strategicOverlayCloseWorkspaceBtn',
            'strategicOverlayIconCloseBtn',
            'unitCounterEditorModalOverlay',
        ]:
            self.assertIn(token, content)
        self.assertIn('t("Derived Frontlines", "ui")', content)
        self.assertIn('t("Strategic Annotations", "ui")', content)
        self.assertIn('t("lines", "ui")', content)
        self.assertIn('t("graphics", "ui")', content)
        self.assertIn('t("counters", "ui")', content)
        self.assertIn('t("Export as Strategic annotations", "ui")', content)
        self.assertIn('publishStatus.setAttribute("role", "status");', content)
        self.assertIn('publishStatus.setAttribute("aria-live", "polite");', content)
        self.assertIn('invalidateFrontlineOverlayState,', content)

    def test_sidebar_strategic_overlay_static_dom_uses_text_nodes_for_translated_copy(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("const buildCheckboxLabel = (id, label, className) => {", content)
        self.assertIn("const buildCombatBar = ({ id, label, className }) => {", content)
        self.assertIn('button.textContent = t(label, "ui");', content)
        for forbidden_owner in [
            "enableToggle.innerHTML",
            "emptyState.innerHTML",
            "frontlineLabelToggle.innerHTML",
            "unitCombatBars.innerHTML",
            "unitLabelToggle.innerHTML",
            "unitScaleShell.innerHTML",
            "unitListHeader.innerHTML",
            "strategicCommandBar.innerHTML",
        ]:
            self.assertNotIn(forbidden_owner, content)

    def test_controller_refreshes_strategic_annotation_publish_status(self):
        content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("strategicOverlayPublishStatus,", content)
        self.assertIn("const refreshStrategicOverlayPublishStatus = () => {", content)
        self.assertIn("state.operationalLines", content)
        self.assertIn("state.operationGraphics", content)
        self.assertIn("state.unitCounters", content)
        self.assertIn("Export as Strategic annotations", content)
        self.assertIn("Project export saves Strategic annotations.", content)
        self.assertIn("if (strategicOverlayPublishStatus.textContent !== nextText)", content)
        self.assertIn('strategicOverlayPublishStatus.getAttribute("aria-label") !== nextLabel', content)
        self.assertEqual(content.count("refreshStrategicOverlayPublishStatus();"), 1)

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

        self.assertNotIn("getHoi4CatalogFilterOptions", sidebar_content)
        self.assertIn('import { bindUnitCounterSidebarEvents } from "./strategic_overlay/unit_counter_bind_events_helper.js";', controller_content)
        self.assertIn("bindUnitCounterSidebarEvents({", controller_content)
        self.assertIn("helpers: {", controller_content)
        self.assertIn("export function bindUnitCounterSidebarEvents({", helper_content)
        self.assertIn("const syncUnitCounterCombatStateToSelection = (partial = {}, { commitSelected = true } = {}) => {", helper_content)
        self.assertIn('scheduleStrategicOverlayRefresh(["counterCombat", "counterPreview"]);', helper_content)
        self.assertIn('unitCounterCatalog.applyReviewAction({', helper_content)
        self.assertIn('import { getCounterEditorModalFocusableElements } from "./unit_counter_modal_helper.js";', helper_content)
        self.assertIn("getHoi4CatalogFilterOptions(effectivePresetId)", catalog_helper_content)
        self.assertIsNone(re.search(r"const\s+syncUnitCounterCombatStateToSelection\s*=\s*\(partial = \{\}, \{ commitSelected = true \} = \{\}\)\s*=>", controller_content))
        self.assertIsNone(re.search(r"const\s+applyUnitCounterCombatPreset\s*=\s*\(presetId, \{ source = \"preset\" \} = \{\}\)\s*=>", controller_content))

    def test_catalog_lifecycle_is_owned_inside_the_strategic_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        controller_content = STRATEGIC_OVERLAY_CONTROLLER_JS.read_text(encoding="utf-8")
        catalog_content = UNIT_COUNTER_CATALOG_HELPER_JS.read_text(encoding="utf-8")
        self.assertNotIn("requestStrategicOverlayCatalogRefresh", sidebar_content)
        self.assertNotIn("hoi4UnitIconManifestStatus", sidebar_content)
        self.assertNotIn("hoi4UnitIconReviewDraft", sidebar_content)
        self.assertIn("createUnitCounterCatalog({", controller_content)
        self.assertIn('refreshStrategicOverlayUI({ scopes: ["counterCatalog"] })', controller_content)
        self.assertNotIn("callRuntimeHook", catalog_content)

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
