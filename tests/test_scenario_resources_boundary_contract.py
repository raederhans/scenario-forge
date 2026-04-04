from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
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

    def test_post_apply_effects_prewarm_coarse_chunks_before_refresh(self):
        content = SCENARIO_POST_APPLY_EFFECTS.read_text(encoding="utf-8")

        self.assertIn("preloadScenarioCoarseChunks", content)
        self.assertIn("await preloadScenarioCoarseChunks(bundle)", content)
        self.assertIn('reason: "scenario-apply"', content)


if __name__ == "__main__":
    unittest.main()
