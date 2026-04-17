from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_BUNDLE_LOADER = REPO_ROOT / "js" / "core" / "scenario" / "bundle_loader.js"
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_POST_APPLY_EFFECTS = REPO_ROOT / "js" / "core" / "scenario_post_apply_effects.js"
MAIN_JS = REPO_ROOT / "js" / "main.js"
I18N_JS = REPO_ROOT / "js" / "ui" / "i18n.js"
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
SCENARIO_CONTROLS_JS = REPO_ROOT / "js" / "ui" / "scenario_controls.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"


class ScenarioResourcesBoundaryContractTest(unittest.TestCase):
    def test_resource_api_is_exposed_from_scenario_resources(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertIn("export {", content)
        self.assertIn("loadScenarioRegistry,", content)
        self.assertIn("loadScenarioBundle,", content)
        self.assertIn("hydrateActiveScenarioBundle,", content)
        self.assertIn("loadScenarioAuditPayload,", content)
        self.assertIn("releaseScenarioAuditPayload,", content)
        self.assertIn("ensureActiveScenarioOptionalLayerLoaded,", content)
        self.assertIn("ensureActiveScenarioOptionalLayersForVisibility,", content)
        self.assertIn("ensureScenarioGeoLocalePatchForLanguage,", content)
        self.assertIn("validateImportedScenarioBaseline,", content)

    def test_bundle_loader_stays_internal_and_one_way(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        bundle_loader_content = SCENARIO_BUNDLE_LOADER.read_text(encoding="utf-8")

        self.assertIn('./scenario/bundle_loader.js', resources_content)
        self.assertNotIn('./scenario_resources.js', bundle_loader_content)
        self.assertNotIn('./scenario_manager.js', bundle_loader_content)
        self.assertIn("createScenarioRegistryLoader", bundle_loader_content)
        self.assertIn("createScenarioAuditPayloadLoader", bundle_loader_content)
        self.assertIn("createImportedScenarioBaselineValidator", bundle_loader_content)

    def test_external_callers_no_longer_pull_resource_api_from_scenario_manager(self):
        self.assertIn('./core/scenario_resources.js', MAIN_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_resources.js', I18N_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_resources.js', SIDEBAR_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_resources.js', TOOLBAR_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_resources.js', SCENARIO_CONTROLS_JS.read_text(encoding="utf-8"))
        self.assertIn('./scenario_resources.js', INTERACTION_FUNNEL_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_shell_overlay.js', SIDEBAR_JS.read_text(encoding="utf-8"))
        self.assertNotIn('../core/scenario_manager.js', SIDEBAR_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_recovery.js', SCENARIO_CONTROLS_JS.read_text(encoding="utf-8"))

    def test_resources_module_does_not_keep_orchestration_single_flight_state(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertNotIn("let activeScenarioApplyPromise = null;", content)

    def test_chunk_runtime_state_stays_out_of_bundle_cache(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        manager_content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertIn("chunkPayloadPromisesById", resources_content)
        self.assertIn("hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)", resources_content)
        self.assertNotIn("bundle.chunkMergedLayerPayloads", resources_content)
        self.assertNotIn("chunkMergedLayerPayloads:", resources_content)
        self.assertNotIn("bundle.chunkMergedLayerPayloads", manager_content)
        self.assertIn("state.activeScenarioChunks?.mergedLayerPayloads", manager_content)

    def test_post_apply_effects_waits_for_chunked_first_frame_before_returning(self):
        content = SCENARIO_POST_APPLY_EFFECTS.read_text(encoding="utf-8")

        self.assertIn("preloadScenarioCoarseChunks", content)
        self.assertIn("ensureChunkedScenarioFirstFrameReady", content)
        self.assertIn("await preloadScenarioCoarseChunks(bundle);", content)
        self.assertIn("await ensureChunkedScenarioFirstFrameReady({ bundle, scenarioId });", content)
        self.assertNotIn("void ensureChunkedScenarioFirstFrameReady({ bundle, scenarioId });", content)
        self.assertIn('reason: "scenario-apply"', content)

    def test_full_bundle_prefers_runtime_topology_even_with_chunk_manifest(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertNotIn("preferStartupTopologyForFullBundle", content)
        self.assertIn('manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""', content)

    def test_startup_core_bundle_path_uses_compaction_helpers_and_no_longer_reads_apply_seed_from_payload(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertIn("normalizeIndexedTagAssignmentPayload", content)
        self.assertIn("normalizeIndexedCoreAssignmentPayload", content)
        self.assertIn("normalizeStartupBundleRuntimePoliticalMeta", content)
        self.assertIn("startupApplySeed: null,", content)
        self.assertNotIn('payload?.scenario?.apply_seed', content)


if __name__ == "__main__":
    unittest.main()
