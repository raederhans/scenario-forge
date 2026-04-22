from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
STARTUP_DATA_PIPELINE_JS = REPO_ROOT / "js" / "bootstrap" / "startup_data_pipeline.js"
DATA_LOADER_JS = REPO_ROOT / "js" / "core" / "data_loader.js"


class MainStartupDataPipelineBoundaryContractTest(unittest.TestCase):
    def test_main_imports_startup_data_pipeline_owner(self):
        content = MAIN_JS.read_text(encoding="utf-8")
        normalized = content.replace('"', "'")

        self.assertIn("./bootstrap/startup_data_pipeline.js", normalized)
        self.assertIn("createStartupDataPipelineOwner", content)
        self.assertIn("let startupDataPipelineOwner = null;", content)
        self.assertIn("function getStartupDataPipelineOwner() {", content)

    def test_owner_keeps_startup_data_pipeline_helpers(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")
        owner_content = STARTUP_DATA_PIPELINE_JS.read_text(encoding="utf-8")

        self.assertIn("const CONTEXT_LAYER_LOAD_ORDER = [", owner_content)
        self.assertIn("const PHYSICAL_CONTEXT_LAYER_SET = [", owner_content)
        self.assertIn("const PHYSICAL_CONTOUR_LAYER_SET = [", owner_content)
        self.assertIn("export function createStartupDataPipelineOwner({", owner_content)
        self.assertIn("async function ensureBaseCityDataReady({ reason = \"manual\", renderNow = true } = {}) {", owner_content)
        self.assertIn("async function ensureFullLocalizationDataReady({ reason = \"post-ready\", renderNow = true } = {}) {", owner_content)
        self.assertIn("async function ensureActiveScenarioBundleHydrated({ reason = \"post-ready\", renderNow = true } = {}) {", owner_content)
        self.assertIn("function shouldFastTrackScenarioHydration() {", owner_content)
        self.assertIn("function expandDeferredContextLayerNames(requestedLayerNames) {", owner_content)
        self.assertIn("function updateContextLayerDerivedState(layerName, collection) {", owner_content)
        self.assertIn("async function ensureContextLayerDataReady(", owner_content)

        self.assertIsNone(re.search(r"function\s+expandDeferredContextLayerNames\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+updateContextLayerDerivedState\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+topologyAlreadyProvidesContextLayer\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+hasHydrationFeatureCollectionData\s*\(", donor_content))

    def test_main_keeps_bootstrap_facade_and_owner_wrappers(self):
        content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("return getStartupDataPipelineOwner().ensureBaseCityDataReady({ reason, renderNow });", content)
        self.assertIn("return getStartupDataPipelineOwner().ensureFullLocalizationDataReady({ reason, renderNow });", content)
        self.assertIn("return getStartupDataPipelineOwner().ensureActiveScenarioBundleHydrated({ reason, renderNow });", content)
        self.assertIn("return getStartupDataPipelineOwner().shouldFastTrackScenarioHydration();", content)
        self.assertIn("return getStartupDataPipelineOwner().ensureContextLayerDataReady(requestedLayerNames, {", content)
        self.assertIn('registerRuntimeHook(state, "ensureFullLocalizationDataReadyFn", ensureFullLocalizationDataReady);', content)
        self.assertIn("ensureBaseCityDataReadyFn: ensureBaseCityDataReady,", content)
        self.assertIn("ensureContextLayerDataReadyFn: ensureContextLayerDataReady,", content)
        self.assertIn("persistViewSettingsFn: persistViewSettings,", content)
        self.assertIn("const startupDataPipeline = getStartupDataPipelineOwner();", content)
        self.assertIn("startupDataPipeline.resolveStartupScenarioBootstrap({ d3Client });", content)
        self.assertIn("startupDataPipeline.loadStartupBaseData({", content)
        self.assertIn("async function bootstrap()", content)
        self.assertIn("bootstrap();", content)

    def test_owner_keeps_context_layer_and_hydration_contracts(self):
        owner_content = STARTUP_DATA_PIPELINE_JS.read_text(encoding="utf-8")

        self.assertIn('startBootMetric?.("localization:full:load");', owner_content)
        self.assertIn('finishBootMetric?.("scenario:full:hydrate", {', owner_content)
        self.assertIn("const cityPatch = buildCityLocalizationPatch({", owner_content)
        self.assertIn("syncScenarioLocalizationState({", owner_content)
        self.assertIn("invalidateContextLayerVisualStateBatch?.(loadedLayerNames, `context-layer:${reason}`, {", owner_content)
        self.assertIn("checkpointBootMetric?.(`layer:${layerName}:first-render-after-load`);", owner_content)
        self.assertIn("manifest.runtime_topology_url", owner_content)
        self.assertIn("function resolveStartupScenarioBootstrap({ d3Client } = {}) {", owner_content)
        self.assertIn("async function loadStartupBaseData({", owner_content)
        self.assertIn("function hydrateStartupBaseState({", owner_content)
        self.assertIn("function decodeStartupPrimaryCollections({", owner_content)
        self.assertIn("loadStartupBundleViaWorker({", owner_content)
        self.assertIn("createStartupBundleLoadDiagnostics({", owner_content)
        self.assertIn('getStartupScenarioSupportUrl(startupFallbackScenarioId, "locales.startup.json")', owner_content)
        self.assertIn('getStartupScenarioSupportUrl(startupFallbackScenarioId, "geo_aliases.startup.json")', owner_content)
        self.assertIn("currentLanguage: state.currentLanguage || \"en\",", owner_content)
        self.assertIn("hydrateStartupBaseContentState(state, {", owner_content)
        self.assertIn("decodeStartupPrimaryCollectionsIntoState(state, {", owner_content)

    def test_data_loader_uses_explicit_language_input_for_startup_cache_keys(self):
        content = DATA_LOADER_JS.read_text(encoding="utf-8")

        self.assertIn('currentLanguage = "en",', content)
        self.assertIn("createStartupLocalizationCacheKey({", content)
        self.assertIn('currentLanguage: String(currentLanguage || "en").trim() || "en",', content)
        self.assertIn('language: String(currentLanguage || "en").trim() || "en",', content)
        self.assertNotIn('import { state } from "./state.js";', content)
        self.assertNotIn("state.currentLanguage", content)


if __name__ == "__main__":
    unittest.main()
