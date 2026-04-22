from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_JS = REPO_ROOT / "js" / "core" / "state.js"
STATE_DEFAULTS_JS = REPO_ROOT / "js" / "core" / "state_defaults.js"
STATE_CATALOG_JS = REPO_ROOT / "js" / "core" / "state_catalog.js"
STATE_INDEX_JS = REPO_ROOT / "js" / "core" / "state" / "index.js"
STATE_CONFIG_JS = REPO_ROOT / "js" / "core" / "state" / "config.js"
STATE_BUS_JS = REPO_ROOT / "js" / "core" / "state" / "bus.js"
STATE_HISTORY_JS = REPO_ROOT / "js" / "core" / "state" / "history_state.js"
STATE_DEV_JS = REPO_ROOT / "js" / "core" / "state" / "dev_state.js"
STATE_STRATEGIC_OVERLAY_JS = REPO_ROOT / "js" / "core" / "state" / "strategic_overlay_state.js"
STATE_SCENARIO_RUNTIME_JS = REPO_ROOT / "js" / "core" / "state" / "scenario_runtime_state.js"
STATE_BORDER_CACHE_JS = REPO_ROOT / "js" / "core" / "state" / "border_cache_state.js"
STATE_RENDERER_RUNTIME_JS = REPO_ROOT / "js" / "core" / "state" / "renderer_runtime_state.js"
STATE_SPATIAL_INDEX_JS = REPO_ROOT / "js" / "core" / "state" / "spatial_index_state.js"
STATE_BOOT_JS = REPO_ROOT / "js" / "core" / "state" / "boot_state.js"
STATE_CONTENT_JS = REPO_ROOT / "js" / "core" / "state" / "content_state.js"
STATE_COLOR_JS = REPO_ROOT / "js" / "core" / "state" / "color_state.js"
STATE_UI_JS = REPO_ROOT / "js" / "core" / "state" / "ui_state.js"


class StateSplitBoundaryContractTest(unittest.TestCase):
    def test_state_imports_defaults_module(self):
        content = STATE_JS.read_text(encoding="utf-8")

        self.assertIn('./state_defaults.js', content.replace('"', "'"))
        self.assertIn('./state_catalog.js', content.replace('"', "'"))
        self.assertIn('./state/index.js', content.replace('"', "'"))
        self.assertIn('./state/history_state.js', content.replace('"', "'"))
        self.assertIn('./state/dev_state.js', content.replace('"', "'"))
        self.assertIn('./state/strategic_overlay_state.js', content.replace('"', "'"))
        self.assertIn('./state/scenario_runtime_state.js', content.replace('"', "'"))
        self.assertIn('./state/border_cache_state.js', content.replace('"', "'"))
        self.assertIn('./state/renderer_runtime_state.js', content.replace('"', "'"))
        self.assertIn('./state/spatial_index_state.js', content.replace('"', "'"))
        self.assertIn('./state/boot_state.js', content.replace('"', "'"))
        self.assertIn('./state/content_state.js', content.replace('"', "'"))
        self.assertIn('./state/color_state.js', content.replace('"', "'"))
        self.assertIn('./state/ui_state.js', content.replace('"', "'"))
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
        self.assertIn('export function normalizeMapSemanticMode(value, fallback = "political")', owner_content)

        self.assertIsNone(re.search(r"function\s+normalizePhysicalStyleConfig\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeTextureStyleConfig\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeDayNightStyleConfig\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeTransportWorkbenchUiState\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+normalizeExportWorkbenchUiState\s*\(", donor_content))

    def test_state_keeps_compat_reexports_and_singleton(self):
        content = STATE_JS.read_text(encoding="utf-8")
        defaults_content = STATE_DEFAULTS_JS.read_text(encoding="utf-8")

        self.assertIn("defaultZoom", defaults_content)
        self.assertIn('} from "./state_defaults.js";', content)
        self.assertIn('} from "./state_catalog.js";', content)
        self.assertIn('} from "./state/index.js";', content)
        self.assertIn('export * from "./state_defaults.js";', content)
        self.assertIn('export * from "./state_catalog.js";', content)
        self.assertIn('export * from "./state/index.js";', content)
        self.assertIn("bindStateCompatSurface(state);", content)
        self.assertIn("normalizeMapSemanticMode", defaults_content)
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

    def test_state_index_owns_runtime_hook_compat_helpers(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_INDEX_JS.read_text(encoding="utf-8")
        config_content = STATE_CONFIG_JS.read_text(encoding="utf-8")

        self.assertIn("export function registerRuntimeHook(target, hookName, hook) {", owner_content)
        self.assertIn("export function readRuntimeHook(target, hookName) {", owner_content)
        self.assertIn("export function callRuntimeHook(target, hookName, ...args) {", owner_content)
        self.assertIn("export function callRuntimeHooks(target, hookNames, ...args) {", owner_content)
        self.assertIn("export function bindStateCompatSurface(target) {", owner_content)
        self.assertIn("export const STATE_BUS_EVENTS = Object.freeze({", config_content)
        self.assertIn("export const STATE_NOTIFICATION_HOOK_NAMES = Object.freeze", config_content)
        self.assertIn("export const STATE_HANDLER_HOOK_NAMES = Object.freeze", config_content)
        self.assertNotIn("createDefaultRuntimeHooks", donor_content)

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

        self.assertIn('export function createDefaultActiveScenarioChunksState(scenarioId = "")', owner_content)
        self.assertIn('export function createDefaultRuntimeChunkLoadState({ scenarioId = "" } = {})', owner_content)
        self.assertIn("export function createDefaultScenarioDataHealth(minRatio = 0.7)", owner_content)
        self.assertIn("export function createDefaultScenarioHydrationHealthGate()", owner_content)
        self.assertIn("export function createDefaultScenarioRuntimeState({", owner_content)
        self.assertIn("...createDefaultScenarioRuntimeState(),", donor_content)
        self.assertIsNone(re.search(r"activeScenarioChunks:\s*\{", donor_content))
        self.assertIsNone(re.search(r"runtimeChunkLoadState:\s*\{", donor_content))

    def test_renderer_runtime_owner_holds_renderer_runtime_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_RENDERER_RUNTIME_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultRendererInfrastructureState()", owner_content)
        self.assertIn("export function createDefaultRenderPassCacheState()", owner_content)
        self.assertIn("export function createDefaultSidebarPerfState()", owner_content)
        self.assertIn("export function createDefaultProjectedBoundsCacheState()", owner_content)
        self.assertIn("export function createDefaultRendererTransientRuntimeState()", owner_content)
        self.assertIn("...createDefaultRendererInfrastructureState(),", donor_content)
        self.assertIn("...createDefaultRendererTransientRuntimeState(),", donor_content)
        self.assertIsNone(re.search(r"renderPassCache:\s*\{", donor_content))
        self.assertIsNone(re.search(r"sidebarPerf:\s*\{", donor_content))
        self.assertIsNone(re.search(r"hitCanvasDirty:\s*true,", donor_content))

    def test_border_cache_owner_holds_border_cache_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_BORDER_CACHE_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultBorderCacheState()", owner_content)
        self.assertIn("cachedProvinceBordersByCountry: new Map(),", owner_content)
        self.assertIn("cachedParentBordersByCountry: new Map(),", owner_content)
        self.assertIn("...createDefaultBorderCacheState(),", donor_content)
        self.assertIsNone(re.search(r"cachedBorders:\s*null,", donor_content))
        self.assertIsNone(re.search(r"cachedCoastlines:\s*null,", donor_content))

    def test_spatial_index_owner_holds_lookup_and_spatial_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_SPATIAL_INDEX_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultSecondarySpatialIndexState()", owner_content)
        self.assertIn("export function createDefaultSpatialIndexState()", owner_content)
        self.assertIn("landIndex: new Map(),", owner_content)
        self.assertIn("waterSpatialGrid: new Map(),", owner_content)
        self.assertIn("...createDefaultSpatialIndexState(),", donor_content)
        self.assertIsNone(re.search(r"landIndex:\s*new Map\(\),", donor_content))
        self.assertIsNone(re.search(r"waterSpatialItems:\s*\[\],", donor_content))

    def test_boot_state_owner_holds_boot_defaults(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_BOOT_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDefaultStartupBootCacheState()", owner_content)
        self.assertIn("export function createDefaultBootState()", owner_content)
        self.assertIn('export function setStartupInteractionMode(target, mode = "readonly")', owner_content)
        self.assertIn("export function setStartupBootCacheState(target, nextState = null)", owner_content)
        self.assertIn("if (error !== undefined) {", owner_content)
        self.assertIn("if (canContinueWithoutScenario !== undefined) {", owner_content)
        self.assertIn('bootPhase: "shell",', owner_content)
        self.assertIn('startupInteractionMode: "readonly",', owner_content)
        self.assertIn("startupBootCacheState: createDefaultStartupBootCacheState(),", owner_content)
        self.assertIn("...createDefaultBootState(),", donor_content)
        self.assertIsNone(re.search(r'bootPhase:\s*"shell",', donor_content))

    def test_bus_owner_holds_runtime_hook_bus_state(self):
        donor_content = STATE_JS.read_text(encoding="utf-8")
        owner_content = STATE_BUS_JS.read_text(encoding="utf-8")

        self.assertIn("export function on(eventName, listener) {", owner_content)
        self.assertIn("export function off(eventName, listener = null) {", owner_content)
        self.assertIn("export function emit(eventName, payload) {", owner_content)
        self.assertIn("export function once(eventName, listener) {", owner_content)
        self.assertIn("bindStateCompatSurface(state);", donor_content)


if __name__ == "__main__":
    unittest.main()
