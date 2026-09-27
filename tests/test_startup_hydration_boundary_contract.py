from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_STARTUP_HYDRATION = REPO_ROOT / "js" / "core" / "scenario" / "startup_hydration.js"
SCENARIO_CHUNK_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "chunk_runtime.js"
SCENARIO_RUNTIME_STATE = REPO_ROOT / "js" / "core" / "state" / "scenario_runtime_state.js"
SCENARIO_SHELL_OVERLAY = REPO_ROOT / "js" / "core" / "scenario_shell_overlay.js"
MAP_RENDERER = REPO_ROOT / "js" / "core" / "map_renderer.js"


class StartupHydrationBoundaryContractTest(unittest.TestCase):
    def test_resources_facade_keeps_startup_hydration_exports_and_wiring(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        startup_hydration_content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")

        self.assertIn("./scenario/startup_hydration.js", resources_content)
        self.assertIn("createScenarioStartupHydrationController", resources_content)
        self.assertIn(
            "hasRenderableScenarioPoliticalTopology: hasRenderableScenarioPoliticalTopologyFromStartupHydration",
            resources_content,
        )
        self.assertIn(
            "const hasRenderableScenarioPoliticalTopology = hasRenderableScenarioPoliticalTopologyFromStartupHydration;",
            resources_content,
        )
        self.assertIn("./scenario/scenario_renderer_bridge.js", resources_content)
        self.assertIn("createStartupHydrationRefreshPlan,", resources_content.split('} from "./scenario/scenario_renderer_bridge.js";')[0])
        self.assertIn("refreshScenarioOpeningOwnerBorders,", resources_content.split('} from "./scenario/scenario_renderer_bridge.js";')[0])
        self.assertIn("createStartupHydrationRefreshPlan,", resources_content)
        self.assertIn("hydrateActiveScenarioBundle,", resources_content)
        self.assertIn("evaluateScenarioHydrationHealthGateState,", resources_content)
        self.assertIn("enforceScenarioHydrationHealthGate,", resources_content)
        self.assertIn("ensureScenarioGeoLocalePatchForLanguage,", resources_content)
        self.assertIn("applyBlankScenarioPresentationDefaults,", resources_content)
        self.assertIn("refreshScenarioOpeningOwnerBorders,", resources_content)
        self.assertNotIn("./scenario_resources.js", startup_hydration_content)
        self.assertNotIn("./scenario_manager.js", startup_hydration_content)

    def test_hydrate_bundle_guard_and_boolean_contract_stay_stable(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")

        self.assertIn("areScenarioFeatureCollectionsEquivalent,", content)
        self.assertIn("const hasPoliticalPayloadChange = !areScenarioFeatureCollectionsEquivalent(", content)
        self.assertIn("nextScenarioPoliticalPayload,", content)
        self.assertIn("previousScenarioPoliticalPayload", content)
        self.assertIn("bundleScenarioId !== normalizeScenarioId(state.activeScenarioId)", content)
        self.assertIn("return false;", content)
        self.assertIn("return true;", content)
        self.assertNotIn("scheduleScenarioChunkRefreshFn", content)
        self.assertNotIn("flushPendingScenarioChunkRefreshAfterReady", content)

    def test_health_gate_retry_and_result_shape_stay_stable(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")
        runtime_state_content = SCENARIO_RUNTIME_STATE.read_text(encoding="utf-8")

        self.assertIn("ok: true, attemptedRetry: false, degradedWaterOverlay: false, report: null", content)
        self.assertIn("forceReload: true,", content)
        self.assertIn('bundleLevel: "full"', content)
        self.assertIn("hydrateActiveScenarioBundle(refreshedBundle, { renderNow: false });", content)
        self.assertIn('attemptedRetry ? "retry-recovered" : "ok"', content)
        self.assertIn("SCENARIO_HYDRATION_HEALTH_REASONS.ownerFeatureMismatch", content)
        self.assertIn('ownerFeatureMismatch: "owner-feature-mismatch"', runtime_state_content)
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
        self.assertIn('getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political", bundle)', content)
        self.assertIn("const promotableFeatures = features.filter", content)
        self.assertIn("{ ...collection, features: promotableFeatures }", content)
        self.assertIn("let nextScenarioPoliticalPayload = previousScenarioPoliticalPayload || null", content)
        self.assertIn("if (runtimePoliticalPayloadDecision.hasPayload)", content)
        self.assertIn("if (decodedPoliticalPayloadDecision.hasPayload)", content)
        self.assertIn("if (mergedPoliticalPayload !== undefined)", content)
        self.assertIn("const previousScenarioPoliticalPayload = state.scenarioPoliticalChunkData;", content)
        self.assertIn("const hasPoliticalPayloadChange = !areScenarioFeatureCollectionsEquivalent", content)
        self.assertIn("applyScenarioPoliticalChunkPayload(", content)
        self.assertIn('reason: "scenario-hydrate-political"', content)
        self.assertIn("renderNow: false,", content)
        self.assertIn("createStartupHydrationRefreshPlan = null,", content)
        self.assertIn("refreshPlan: typeof createStartupHydrationRefreshPlan === \"function\"", content)
        self.assertIn('reason: "scenario-hydrate-opening"', content)
        self.assertIn("state.activeScenarioMeshPack?.meshes?.opening_owner_borders", content)
        self.assertIn("mergedCitiesPayload !== undefined", content)
        self.assertIn("bundle.cityOverridesPayload || null", content)
        self.assertIn("hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)", chunk_runtime_content)

    def test_owner_border_shell_hint_path_stays_wired(self):
        content = SCENARIO_STARTUP_HYDRATION.read_text(encoding="utf-8")
        shell_overlay_content = SCENARIO_SHELL_OVERLAY.read_text(encoding="utf-8")
        renderer_content = MAP_RENDERER.read_text(encoding="utf-8")

        self.assertIn("state.activeScenarioMeshPack?.meshes?.opening_owner_borders", content)
        self.assertIn("refreshScenarioOpeningOwnerBorders({", content)
        self.assertIn('reason: "scenario-hydrate-opening"', content)
        self.assertIn("scenarioAutoShellOwnerByFeatureId", shell_overlay_content)
        self.assertIn('reason: borderReason ? `${borderReason}:opening` : "scenario-shell-opening"', shell_overlay_content)
        self.assertIn("feature?.properties?.scenario_shell_owner_hint", renderer_content)
        self.assertIn("shellOwnerByFeatureId?.[featureId] || shellOwnerHintCode", renderer_content)

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
        self.assertIn("emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);", content)


if __name__ == "__main__":
    unittest.main()
