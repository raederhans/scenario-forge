from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_BUNDLE_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "bundle_runtime.js"
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"


class ScenarioBundleRuntimeBoundaryContractTest(unittest.TestCase):
    def test_bundle_runtime_owns_load_transaction(self):
        runtime_content = SCENARIO_BUNDLE_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("function createScenarioBundleRuntimeController({", runtime_content)
        self.assertIn("async function tryLoadBootstrapBundleFromPersistentCache({", runtime_content)
        self.assertIn("function queueBootstrapBundleCacheWrite({", runtime_content)
        self.assertIn("async function loadScenarioBundle(", runtime_content)
        self.assertIn("const bundleLoadPromisesByKey = new Map();", runtime_content)
        self.assertIn("function buildBundleLoadKey({", runtime_content)
        self.assertIn('`scenario=${normalizeBundleLoadKeyPart(targetId)}`', runtime_content)
        self.assertIn('`level=${normalizeBundleLoadKeyPart(requestedBundleLevel, "full")}`', runtime_content)
        self.assertIn('`language=${normalizeBundleLoadKeyPart(normalizedLanguage, "en")}`', runtime_content)
        self.assertIn("const bundleLoadKey = buildBundleLoadKey({", runtime_content)
        self.assertIn("currentLanguage: state.currentLanguage,", runtime_content)
        self.assertIn("scenarioRegistryVersion: state.scenarioRegistry?.version,", runtime_content)
        self.assertIn("runtimeShellVersion: state.scenarioRuntimeShellVersion,", runtime_content)
        self.assertIn("if (!forceReload && bundleLoadPromisesByKey.has(bundleLoadKey)) {", runtime_content)
        self.assertIn("bundleLoadPromisesByKey.set(bundleLoadKey, loadPromise);", runtime_content)
        self.assertIn("bundleLoadPromisesByKey.delete(bundleLoadKey);", runtime_content)
        self.assertIn('state.scenarioBundleCacheById[targetId] = bundle', runtime_content)
        self.assertIn('state.startupBootCacheState.scenarioBootstrap = scenarioBootstrapCoreCacheKey ? "probe" : "disabled";', runtime_content)
        self.assertIn("createScenarioBootstrapBundleFromCache({", runtime_content)
        self.assertIn("assembleScenarioBundle({", runtime_content)
        self.assertIn("scheduleScenarioDeferredBundleMetadataLoad(bundle, { d3Client });", runtime_content)
        self.assertIn("loadScenarioBundle,", runtime_content)
        self.assertIn("createScenarioBundleRuntimeController,", runtime_content)

    def test_bundle_runtime_stays_internal_and_facade_stays_in_resources(self):
        runtime_content = SCENARIO_BUNDLE_RUNTIME.read_text(encoding="utf-8")
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r'from\\s+"\\.\\./scenario_resources\\.js"', runtime_content))
        self.assertIsNone(re.search(r'from\\s+"\\.\\./scenario_manager\\.js"', runtime_content))
        self.assertIn('./scenario/bundle_runtime.js', resources_content)
        self.assertIn("const {", resources_content)
        self.assertIn("loadScenarioBundle,", resources_content)
        self.assertIn("loadScenarioAuditPayload,", resources_content)

    def test_dedupe_key_distinguishes_concurrent_language_requests(self):
        runtime_content = SCENARIO_BUNDLE_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("normalizeScenarioLanguage(currentLanguage)", runtime_content)
        self.assertIn('`language=${normalizeBundleLoadKeyPart(normalizedLanguage, "en")}`', runtime_content)
        self.assertIn("if (!forceReload && bundleLoadPromisesByKey.has(bundleLoadKey)) {", runtime_content)


if __name__ == "__main__":
    unittest.main()
