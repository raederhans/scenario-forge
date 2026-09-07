from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_OPTIONAL_LAYER_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "optional_layer_runtime.js"
SCENARIO_BUNDLE_LOADER = REPO_ROOT / "js" / "core" / "scenario" / "bundle_loader.js"
SCENARIO_BUNDLE_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "bundle_runtime.js"
SCENARIO_CHUNK_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "chunk_runtime.js"
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_POST_APPLY_EFFECTS = REPO_ROOT / "js" / "core" / "scenario_post_apply_effects.js"
SCENARIO_PURE_HELPERS = REPO_ROOT / "js" / "core" / "scenario" / "pure_helpers.js"
MAIN_JS = REPO_ROOT / "js" / "main.js"
STARTUP_DATA_PIPELINE_JS = REPO_ROOT / "js" / "bootstrap" / "startup_data_pipeline.js"
STARTUP_SCENARIO_BOOT_JS = REPO_ROOT / "js" / "bootstrap" / "startup_scenario_boot.js"
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

    def test_bundle_loader_owns_chunk_and_bootstrap_helper_extraction(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        bundle_loader_content = SCENARIO_BUNDLE_LOADER.read_text(encoding="utf-8")

        self.assertIn("loadScenarioChunkFile", bundle_loader_content)
        self.assertIn("createScenarioChunkRegistryEnsurer", bundle_loader_content)
        self.assertIn("createScenarioBootstrapBundleFromCache", bundle_loader_content)
        self.assertIn("createStartupScenarioBundleFromPayload", bundle_loader_content)
        self.assertIn("loadScenarioRuntimeTopologyForBundle", bundle_loader_content)
        self.assertIn("loadScenarioChunkFile,", resources_content)
        self.assertIn("createScenarioChunkRegistryEnsurer,", resources_content)
        self.assertIn("createScenarioBootstrapBundleFromCache,", resources_content)
        self.assertIn("createStartupScenarioBundleFromPayload,", resources_content)
        self.assertIn("ensureScenarioChunkRegistryLoaded = createScenarioChunkRegistryEnsurer({", resources_content)

    def test_resources_module_keeps_loader_factory_wiring(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertIn("const loadScenarioRegistry = createScenarioRegistryLoader({", content)
        self.assertIn("const loadScenarioAuditPayload = createScenarioAuditPayloadLoader({", content)
        self.assertIn("const validateImportedScenarioBaseline = createImportedScenarioBaselineValidator({", content)
        self.assertIn("getLoadScenarioBundle: () => loadScenarioBundleForStartupHydration,", content)
        self.assertIn("loadScenarioBundleForStartupHydration = loadScenarioBundle;", content)

    def test_resources_module_keeps_runtime_state_write_helpers(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertRegex(
            content,
            re.compile(
                r"function applyDeferredScenarioMetadata\(\s*"
                r"bundle,\s*\{\s*"
                r"scenarioId = \"\",\s*"
                r"scenarioApplyEpoch = 0,\s*"
                r"scenarioApplyRequestId = 0,\s*"
                r"isScenarioApplyRequestCurrent = null,\s*"
                r"\} = \{\}\s*\)",
                re.DOTALL,
            ),
        )
        self.assertRegex(
            content,
            re.compile(
                r"applyDeferredScenarioMetadata\(bundle,\s*\{\s*"
                r"scenarioId:\s*leaseContext\.scenarioId,\s*"
                r"scenarioApplyEpoch:\s*leaseContext\.scenarioApplyEpoch,\s*"
                r"scenarioApplyRequestId:\s*leaseContext\.scenarioApplyRequestId,\s*"
                r"isScenarioApplyRequestCurrent:\s*"
                r"leaseContext\.isScenarioApplyRequestCurrent,\s*"
                r"\}\);",
                re.DOTALL,
            ),
        )
        self.assertIn("bundle.deferredMetadataLoadPromise", content)
        self.assertIn("bundle.deferredMetadataCommitLease !== commitLease", content)
        self.assertIn("const leaseContext = commitLease.currentnessContext;", content)
        self.assertIn("function applyScenarioOptionalLayerState(", content)
        self.assertIn("createScenarioOptionalLayerRuntime({", content)
        self.assertIn("scenarioApplyRequestId = 0", content)
        self.assertIn("isScenarioApplyRequestCurrent = null", content)
        self.assertIn("shouldContinueScenarioApplyContext({", content)
        self.assertNotIn("assignOptionalLayerPayloadToActiveScenario", content)
        self.assertNotIn("state.scenarioApplyInFlight", content)

    def test_optional_layer_load_failures_remain_retryable(self):
        content = SCENARIO_OPTIONAL_LAYER_RUNTIME.read_text(encoding="utf-8")

        failure_block = re.search(
            r'console\.warn\(`\[scenario\] Failed to load scenario \$\{layerKey\} layer.*?return null;',
            content,
            re.DOTALL,
        )

        self.assertIsNotNone(failure_block)
        self.assertIn("delete bundle.optionalLayerSettledByKey[layerKey];", failure_block.group(0))
        self.assertNotIn("bundle.optionalLayerSettledByKey[layerKey] = true;", failure_block.group(0))

    def test_renderable_runtime_topology_helper_has_single_owner(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertEqual(content.count("hasRenderableScenarioPoliticalTopologyFromStartupHydration"), 2)
        self.assertEqual(content.count("const hasRenderableScenarioPoliticalTopology ="), 1)
        self.assertEqual(content.count("function hasRenderableScenarioPoliticalTopology("), 0)

    def test_fresh_bundle_assembly_moves_to_bundle_loader_factory(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        bundle_loader_content = SCENARIO_BUNDLE_LOADER.read_text(encoding="utf-8")

        self.assertIn("createScenarioBundleAssembler", bundle_loader_content)
        self.assertIn("const assembleScenarioBundle = createScenarioBundleAssembler({", resources_content)
        self.assertNotIn('./state.js', bundle_loader_content)
        self.assertNotIn('./scenario_ui_sync.js', bundle_loader_content)

    def test_bundle_runtime_owner_holds_bundle_cache_and_startup_cache_writeback(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        runtime_content = SCENARIO_BUNDLE_RUNTIME.read_text(encoding="utf-8")

        self.assertIn('./scenario/bundle_runtime.js', resources_content)
        self.assertIn("createScenarioBundleRuntimeController({", resources_content)
        self.assertIn("loadScenarioBundle,", resources_content)
        self.assertIn('state.scenarioBundleCacheById[targetId] = bundle', runtime_content)
        self.assertIn('import { setStartupScenarioBootstrapCacheStatus } from "../state/actions/boot_actions.js";', runtime_content)
        self.assertIn('scenarioBootstrapCoreCacheKey ? "probe" : "disabled",', runtime_content)
        self.assertIn('setStartupScenarioBootstrapCacheStatus(state, "written")', runtime_content)
        self.assertNotIn("state.startupBootCacheState.scenarioBootstrap =", runtime_content)
        self.assertIn('createSerializableStartupScenarioBootstrapCorePayload({', runtime_content)
        self.assertIn('createSerializableStartupScenarioBootstrapLocalePayload({', runtime_content)
        self.assertNotIn('./scenario_resources.js', runtime_content)
        self.assertNotIn('./scenario_manager.js', runtime_content)

    def test_external_callers_no_longer_pull_resource_api_from_scenario_manager(self):
        self.assertNotIn('./core/scenario_resources.js', MAIN_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_resources.js', STARTUP_DATA_PIPELINE_JS.read_text(encoding="utf-8"))
        self.assertIn('../core/scenario_resources.js', STARTUP_SCENARIO_BOOT_JS.read_text(encoding="utf-8"))
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

    def test_resources_module_releases_presentation_runtime_owner(self):
        content = SCENARIO_RESOURCES.read_text(encoding="utf-8")

        self.assertIn('./scenario/presentation_hint_helpers.js', content)
        self.assertNotIn('./scenario/presentation_runtime.js', content)
        self.assertIn("normalizeScenarioPerformanceHints,", content)
        self.assertNotIn("createScenarioPresentationRuntime(", content)
        self.assertNotIn("SCENARIO_RENDER_PROFILES", content)
        self.assertIsNone(re.search(r"^function\s+syncScenarioInspectorSelection\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+captureScenarioDisplaySettingsBeforeActivate\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+applyScenarioPerformanceHints\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restoreScenarioDisplaySettingsAfterExit\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+getScenarioOceanFillOverride\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+syncScenarioOceanFillForActivation\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restoreScenarioOceanFillAfterExit\b", content, re.MULTILINE))

    def test_chunk_runtime_state_stays_out_of_bundle_cache(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        chunk_runtime_content = SCENARIO_CHUNK_RUNTIME.read_text(encoding="utf-8")
        manager_content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertIn("./scenario/chunk_runtime.js", resources_content)
        self.assertIn("chunkPayloadPromisesById", (REPO_ROOT / "js/core/scenario/chunk_payload_loader.js").read_text(encoding="utf-8"))
        self.assertIn("hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)", chunk_runtime_content)
        self.assertNotIn("bundle.chunkMergedLayerPayloads", resources_content)
        self.assertNotIn("chunkMergedLayerPayloads:", resources_content)
        self.assertNotIn("bundle.chunkMergedLayerPayloads", manager_content)
        self.assertIn("runtimeState.activeScenarioChunks?.mergedLayerPayloads", manager_content)

    def test_post_apply_effects_defers_startup_boot_chunk_prewarm(self):
        content = SCENARIO_POST_APPLY_EFFECTS.read_text(encoding="utf-8")
        apply_body = content.split("async function runPostScenarioApplyEffects(", 1)[1].split(
            "function runPostScenarioResetEffects(",
            1,
        )[0]

        self.assertIn("preloadScenarioCoarseChunks", content)
        self.assertIn("ensureChunkedScenarioFirstFrameReady", content)
        self.assertIn("async function syncVisibleScenarioOptionalLayersForPostApply({", content)
        self.assertIn("if (runtimeState.bootBlocking) {", content)
        self.assertIn("await ensureActiveScenarioOptionalLayersForVisibility({", content)
        self.assertIn("scenarioApplyRequestId: transactionScenarioApplyRequestId", content)
        self.assertIn("isScenarioApplyRequestCurrent", content)
        self.assertIn("const coarsePayload = await preloadScenarioCoarseChunks(bundle);", content)
        self.assertIn("awaitPrewarm = true", content)
        self.assertIn("awaited: shouldAwaitPrewarm", content)
        self.assertIn("coarsePrewarmAwaited: shouldAwaitPrewarm", content)
        self.assertIn("coarsePrewarmCommitted: false", content)
        self.assertIn("coarsePrewarmCommitted = !!coarsePayload;", content)
        self.assertIn('deferChunkPrewarm = false', content)
        self.assertIn('awaitPrewarm: !deferChunkPrewarm', content)
        self.assertNotIn('interactionLevel = "full"', content)
        self.assertIn("prewarmDeferredAt: refreshScheduledAt", content)
        self.assertIn("coarsePrewarmDeferredAt: refreshScheduledAt", content)
        self.assertIn("chunkRefreshScheduledAt: refreshScheduledAt", content)
        self.assertIn("hints.sync_focus_detail_prewarm_default === true", content)
        self.assertIn("await ensureChunkedScenarioFirstFrameReady({", content)
        optional_sync_call = "await syncVisibleScenarioOptionalLayersForPostApply({"
        self.assertIn(optional_sync_call, content)
        self.assertIn("scenarioApplyEpoch: transactionScenarioApplyEpoch", content)
        self.assertIn("scenarioApplyRequestId: transactionScenarioApplyRequestId", content)
        self.assertIn("isScenarioApplyRequestCurrent", content)
        self.assertLess(
            apply_body.index("await ensureChunkedScenarioFirstFrameReady({"),
            apply_body.index(optional_sync_call),
        )
        self.assertNotIn("void ensureChunkedScenarioFirstFrameReady({ bundle, scenarioId });", content)
        self.assertIn('reason: "scenario-apply"', content)

    def test_reset_post_apply_effects_request_render_after_deferred_refresh(self):
        content = SCENARIO_POST_APPLY_EFFECTS.read_text(encoding="utf-8")

        self.assertIn('import { requestRender } from "./render_boundary.js";', content)
        self.assertIn("scheduleAfterFirstFrame(() => {", content)
        self.assertIn("requestRender(`scenario-reset-post-frame:${scenarioId}`);", content)

    def test_scenario_ui_and_perf_metrics_use_owner_write_paths(self):
        controls_content = SCENARIO_CONTROLS_JS.read_text(encoding="utf-8")
        post_apply_content = SCENARIO_POST_APPLY_EFFECTS.read_text(encoding="utf-8")
        pure_helpers_content = SCENARIO_PURE_HELPERS.read_text(encoding="utf-8")

        self.assertIn('registerRuntimeHook(state, "updateScenarioUIFn", renderScenarioControls);', controls_content)
        self.assertNotIn("runtimeState.updateScenarioUIFn = renderScenarioControls;", controls_content)

        self.assertIn('setScenarioPerfMetricState(runtimeState, "chunkedFirstFramePrewarm"', post_apply_content)
        self.assertNotIn("runtimeState.scenarioPerfMetrics = {};", post_apply_content)

        self.assertIn("recordScenarioPerfMetricState(state, name, durationMs, details);", pure_helpers_content)
        self.assertNotIn("state.scenarioPerfMetrics = {};", pure_helpers_content)

    def test_full_bundle_prefers_runtime_topology_even_with_chunk_manifest(self):
        content = SCENARIO_BUNDLE_RUNTIME.read_text(encoding="utf-8")

        self.assertNotIn("preferStartupTopologyForFullBundle", content)
        self.assertIn('manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""', content)

    def test_startup_core_bundle_path_uses_compaction_helpers_and_no_longer_reads_apply_seed_from_payload(self):
        resources_content = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        bundle_loader_content = SCENARIO_BUNDLE_LOADER.read_text(encoding="utf-8")

        self.assertIn("normalizeIndexedTagAssignmentPayload", bundle_loader_content)
        self.assertIn("normalizeIndexedCoreAssignmentPayload", bundle_loader_content)
        self.assertIn("normalizeStartupBundleRuntimePoliticalMeta", resources_content)
        self.assertIn("startupApplySeed: null,", bundle_loader_content)
        self.assertNotIn('payload?.scenario?.apply_seed', bundle_loader_content)


if __name__ == "__main__":
    unittest.main()
