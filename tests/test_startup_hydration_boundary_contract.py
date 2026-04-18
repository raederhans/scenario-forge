from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_STARTUP_HYDRATION = REPO_ROOT / "js" / "core" / "scenario" / "startup_hydration.js"
SCENARIO_CHUNK_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "chunk_runtime.js"


class StartupHydrationBoundaryContractTest(unittest.TestCase):
    def test_resources_facade_keeps_startup_hydration_exports_and_wiring(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        startup_hydration_content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")

        self.assertIn("./scenario/startup_hydration.js", resources_content)
        self.assertIn("createScenarioStartupHydrationController", resources_content)
        self.assertIn("hydrateActiveScenarioBundle,", resources_content)
        self.assertIn("evaluateScenarioHydrationHealthGateState,", resources_content)
        self.assertIn("enforceScenarioHydrationHealthGate,", resources_content)
        self.assertIn("ensureScenarioGeoLocalePatchForLanguage,", resources_content)
        self.assertIn("applyBlankScenarioPresentationDefaults,", resources_content)
        self.assertNotIn("./scenario_resources.js", startup_hydration_content)
        self.assertNotIn("./scenario_manager.js", startup_hydration_content)

    def test_hydrate_bundle_guard_and_boolean_contract_stay_stable(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")

        self.assertIn("bundleScenarioId !== normalizeScenarioId(state.activeScenarioId)", content)
        self.assertIn("return false;", content)
        self.assertIn("return true;", content)

    def test_health_gate_retry_and_result_shape_stay_stable(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")

        self.assertIn("ok: true, attemptedRetry: false, degradedWaterOverlay: false, report: null", content)
        self.assertIn("forceReload: true,", content)
        self.assertIn('bundleLevel: "full"', content)
        self.assertIn("hydrateActiveScenarioBundle(refreshedBundle, { renderNow: false });", content)
        self.assertIn('attemptedRetry ? "retry-recovered" : "ok"', content)
        self.assertIn('"owner-feature-mismatch"', content)
        self.assertIn("`runtime-overlay-${waterConsistency.reason}`", content)

    def test_merged_payload_and_topology_fallback_boundary_stays_stable(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")
        chunk_runtime_content = SCENARIO_CHUNK_RUNTIME.read_text(encoding="utf-8")

        self.assertIn('hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "water")', content)
        self.assertIn('hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "political")', content)
        self.assertIn('hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "cities")', content)
        self.assertIn("mergedWaterPayload !== undefined", content)
        self.assertIn("bundleWaterPayload != null ? bundleWaterPayload : decodedWaterPayload", content)
        self.assertIn("|| topologyWaterPayload", content)
        self.assertIn("|| state.scenarioWaterRegionsData", content)
        self.assertIn("mergedPoliticalPayload !== undefined", content)
        self.assertIn('getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political")', content)
        self.assertIn("|| state.scenarioPoliticalChunkData", content)
        self.assertIn("mergedCitiesPayload !== undefined", content)
        self.assertIn("bundle.cityOverridesPayload || null", content)
        self.assertIn("hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)", chunk_runtime_content)

    def test_geo_locale_patch_and_blank_defaults_stay_stable(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")

        self.assertIn("syncScenarioLocalizationState({ geoLocalePatchPayload: null })", content)
        self.assertIn("bundle.geoLocalePatchPayloadsByLanguage.en = payload;", content)
        self.assertIn("bundle.geoLocalePatchPayloadsByLanguage.zh = payload;", content)
        self.assertIn("bundle.geoLocalePatchPayloadsByLanguage[descriptor.language] = payload;", content)
        self.assertIn("if (normalizeScenarioId(state.activeScenarioId) !== scenarioId) {", content)
        self.assertIn("return payload || null;", content)
        self.assertIn("bundle.geoLocalePatchPayload = payload || null;", content)
        self.assertIn("syncScenarioLocalizationState({ geoLocalePatchPayload: payload || null });", content)
        self.assertIn("cityOverridesPayload: null", content)
        self.assertIn("geoLocalePatchPayload: null", content)
        self.assertIn("state.showCityPoints = false", content)
        self.assertIn("state.updateToolbarInputsFn()", content)


if __name__ == "__main__":
    unittest.main()
