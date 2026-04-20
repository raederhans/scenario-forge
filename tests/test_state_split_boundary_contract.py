from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_JS = REPO_ROOT / "js" / "core" / "state.js"
STATE_DEFAULTS_JS = REPO_ROOT / "js" / "core" / "state_defaults.js"
STATE_CATALOG_JS = REPO_ROOT / "js" / "core" / "state_catalog.js"
RUNTIME_HOOKS_JS = REPO_ROOT / "js" / "core" / "runtime_hooks.js"
STATE_HISTORY_JS = REPO_ROOT / "js" / "core" / "state" / "history_state.js"
STATE_DEV_JS = REPO_ROOT / "js" / "core" / "state" / "dev_state.js"
STATE_STRATEGIC_OVERLAY_JS = REPO_ROOT / "js" / "core" / "state" / "strategic_overlay_state.js"
STATE_SCENARIO_RUNTIME_JS = REPO_ROOT / "js" / "core" / "state" / "scenario_runtime_state.js"


class StateSplitBoundaryContractTest(unittest.TestCase):
    def test_state_imports_defaults_module(self):
        content = STATE_JS.read_text(encoding="utf-8")

        self.assertIn('./state_defaults.js', content.replace('"', "'"))
        self.assertIn('./state_catalog.js', content.replace('"', "'"))
        self.assertIn('./runtime_hooks.js', content.replace('"', "'"))
        self.assertIn('./state/history_state.js', content.replace('"', "'"))
        self.assertIn('./state/dev_state.js', content.replace('"', "'"))
        self.assertIn('./state/strategic_overlay_state.js', content.replace('"', "'"))
        self.assertIn('./state/scenario_runtime_state.js', content.replace('"', "'"))
        self.assertIn('export const state = {', content)

    def test_state_defaults_owns_constants_and_normalizers(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_DEFAULTS_JS.read_text(encoding="utf-8")

        self.assertIn("const PALETTE_THEMES = {", owner_content)
        self.assertIn("const countryPalette = {", owner_content)
        self.assertIn("function normalizePhysicalStyleConfig(rawConfig)", owner_content)
        self.assertIn("function normalizeTextureStyleConfig(rawConfig)", owner_content)
        self.assertIn("function normalizeDayNightStyleConfig(rawConfig)", owner_content)
        self.assertIn("function normalizeTransportWorkbenchUiState(rawUi)", owner_content)
        self.assertIn("function normalizeExportWorkbenchUiState(rawUi)", owner_content)
        self.assertIn("export function normalizeMapSemanticMode(value, fallback = \"political\")", owner_content)

        self.assertIsNone(re.search(r"function\s+normalizePhysicalStyleConfig\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeTextureStyleConfig\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeDayNightStyleConfig\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeTransportWorkbenchUiState\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeExportWorkbenchUiState\s*\(", donor_content))

    def test_state_keeps_compat_reexports_and_singleton(self):
        content = STATE_JS.read_text(encoding="utf-8")
        defaults_content = STATE_DEFAULTS_JS.read_text(encoding="utf-8")

        self.assertIn("defaultZoom", content)
        self.assertIn("defaultZoom", defaults_content)
        self.assertIn('} from "./state_defaults.js";', content)
        self.assertIn('} from "./state_catalog.js";', content)
        self.assertIn('} from "./runtime_hooks.js";', content)
        self.assertIn('export * from "./state_defaults.js";', content)
        self.assertIn('export * from "./state_catalog.js";', content)
        self.assertIn('export * from "./runtime_hooks.js";', content)
        self.assertIn("normalizeMapSemanticMode", defaults_content)
        self.assertIn("zoomTransform: defaultZoom,", content)
        self.assertIn('selectedColor: PALETTE_THEMES["HOI4 Vanilla"][0],', content)
        self.assertIn("exportWorkbenchUi: normalizeExportWorkbenchUiState(null),", content)
        self.assertIn("countryPalette,", content)

    def test_state_catalog_owns_catalog_state_factories(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_CATALOG_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultScenarioReleasableIndex()", owner_content)
        self.assertIn("export function createDefaultScenarioAuditUiState()", owner_content)
        self.assertIn("export function createDefaultStateCatalog()", owner_content)
        self.assertIn("scenarioReleasableIndex: createDefaultScenarioReleasableIndex(),", owner_content)
        self.assertIn("scenarioAuditUi: createDefaultScenarioAuditUiState(),", owner_content)
        self.assertIn("...createDefaultStateCatalog(),", donor_content)
        self.assertIsNone(re.search(r"scenarioReleasableIndex:\s*\{\s*byTag:\s*\{\}", donor_content))
        self.assertIsNone(re.search(r"scenarioAuditUi:\s*\{\s*loading:\s*false", donor_content))

    def test_runtime_hooks_owns_runtime_hook_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = RUNTIME_HOOKS_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultRuntimeHooks()", owner_content)
        self.assertIn("function createDefaultUiRuntimeHooks()", owner_content)
        self.assertIn("function createDefaultCommandRuntimeHooks()", owner_content)
        self.assertIn("function createDefaultDataRuntimeHooks()", owner_content)
        self.assertIn("function createDefaultRenderRuntimeHooks()", owner_content)
        self.assertIn("setStartupReadonlyStateFn: null,", owner_content)
        self.assertIn("ensureFullLocalizationDataReadyFn: null,", owner_content)
        self.assertIn("updateScenarioUIFn: null,", owner_content)
        self.assertIn("updateWorkspaceStatusFn: null,", owner_content)
        self.assertIn("syncDeveloperModeUiFn: null,", owner_content)
        self.assertIn("setDevWorkspaceExpandedFn: null,", owner_content)
        self.assertIn("getStrategicOverlayPerfCountersFn: null,", owner_content)
        self.assertIn("...createDefaultRuntimeHooks(),", donor_content)
        self.assertIsNone(re.search(r"updateScenarioUIFn:\s*null,", donor_content))
        self.assertIsNone(re.search(r"renderNowFn:\s*null,", donor_content))

    def test_history_state_owner_holds_undo_redo_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_HISTORY_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultHistoryState()", owner_content)
        self.assertIn("historyPast: [],", owner_content)
        self.assertIn("historyFuture: [],", owner_content)
        self.assertIn("historyMax: 80,", owner_content)
        self.assertIn("...createDefaultHistoryState(),", donor_content)
        self.assertIsNone(re.search(r"historyPast:\s*\[\],", donor_content))
        self.assertIsNone(re.search(r"historyFuture:\s*\[\],", donor_content))

    def test_dev_state_owner_holds_dev_workspace_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_DEV_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultDevState()", owner_content)
        self.assertIn("devHoverHit: null,", owner_content)
        self.assertIn("devScenarioEditor: {", owner_content)
        self.assertIn("devScenarioTagCreator: {", owner_content)
        self.assertIn("devScenarioCountryEditor: {", owner_content)
        self.assertIn("devLocaleEditor: {", owner_content)
        self.assertIn("devScenarioDistrictEditor: {", owner_content)
        self.assertIn("...createDefaultDevState(),", donor_content)
        self.assertIsNone(re.search(r"devHoverHit:\s*null,", donor_content))
        self.assertIsNone(re.search(r"devScenarioEditor:\s*\{", donor_content))

    def test_strategic_overlay_state_owner_holds_overlay_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_STRATEGIC_OVERLAY_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultSpecialZoneEditorState()", owner_content)
        self.assertIn("export function createDefaultOperationGraphicsEditorState()", owner_content)
        self.assertIn("export function createDefaultUnitCounterEditorState({", owner_content)
        self.assertIn("export function createDefaultOperationalLineEditorState()", owner_content)
        self.assertIn("export function createDefaultStrategicOverlayUiState()", owner_content)
        self.assertIn("export function createDefaultStrategicOverlayState(options = {})", owner_content)
        self.assertIn("...createDefaultStrategicOverlayState(),", donor_content)
        self.assertIsNone(re.search(r"specialZoneEditor:\s*\{", donor_content))
        self.assertIsNone(re.search(r"unitCounterEditor:\s*\{", donor_content))

    def test_scenario_runtime_state_owner_holds_scenario_runtime_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_SCENARIO_RUNTIME_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultActiveScenarioChunksState(scenarioId = \"\")", owner_content)
        self.assertIn("export function createDefaultRuntimeChunkLoadState({ scenarioId = \"\" } = {})", owner_content)
        self.assertIn("export function createDefaultScenarioDataHealth(minRatio = 0.7)", owner_content)
        self.assertIn("export function createDefaultScenarioHydrationHealthGate()", owner_content)
        self.assertIn("export function createDefaultScenarioRuntimeState({", owner_content)
        self.assertIn("...createDefaultScenarioRuntimeState(),", donor_content)
        self.assertIsNone(re.search(r"activeScenarioChunks:\s*\{", donor_content))
        self.assertIsNone(re.search(r"runtimeChunkLoadState:\s*\{", donor_content))


if __name__ == "__main__":
    unittest.main()
