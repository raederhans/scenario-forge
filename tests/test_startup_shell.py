from __future__ import annotations

import unittest
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class StartupShellTest(unittest.TestCase):
    def test_index_html_keeps_startup_preloads_and_deferred_milsymbol(self) -> None:
        html = (REPO_ROOT / "index.html").read_text(encoding="utf-8")

        self.assertIn('<meta name="default-scenario" content="tno_1962" />', html)
        self.assertIn('<link rel="preload" href="data/scenarios/index.json" as="fetch" crossorigin />', html)
        self.assertNotIn('<link rel="preload" href="data/europe_topology.json" as="fetch" crossorigin />', html)
        self.assertNotIn('href="data/scenarios/tno_1962/manifest.json"', html)
        self.assertNotIn('href="data/locales.startup.json"', html)
        self.assertNotIn('href="data/geo_aliases.startup.json"', html)
        self.assertIn('<link rel="modulepreload" href="js/main.js" />', html)

        self.assertNotIn('<script src="vendor/milsymbol.js"></script>', html)

    def test_main_bootstrap_uses_dynamic_ui_imports_and_boot_metrics(self) -> None:
        main_js = (REPO_ROOT / "js" / "main.js").read_text(encoding="utf-8")
        deferred_ui_bootstrap_js = (
            REPO_ROOT / "js" / "bootstrap" / "deferred_ui_bootstrap.js"
        ).read_text(encoding="utf-8")
        ui_shell_boot_js = (
            REPO_ROOT / "js" / "bootstrap" / "ui_shell_boot.js"
        ).read_text(encoding="utf-8")
        render_runtime_binding_js = (
            REPO_ROOT / "js" / "bootstrap" / "render_runtime_binding.js"
        ).read_text(encoding="utf-8")
        startup_failure_recovery_js = (
            REPO_ROOT / "js" / "bootstrap" / "startup_failure_recovery.js"
        ).read_text(encoding="utf-8")
        startup_bootstrap_support_js = (
            REPO_ROOT / "js" / "bootstrap" / "startup_bootstrap_support.js"
        ).read_text(encoding="utf-8")
        startup_boot_overlay_js = (
            REPO_ROOT / "js" / "bootstrap" / "startup_boot_overlay.js"
        ).read_text(encoding="utf-8")
        data_loader_js = (REPO_ROOT / "js" / "core" / "data_loader.js").read_text(encoding="utf-8")
        startup_cache_js = (REPO_ROOT / "js" / "core" / "startup_cache.js").read_text(encoding="utf-8")
        scenario_resources_js = (REPO_ROOT / "js" / "core" / "scenario_resources.js").read_text(encoding="utf-8")
        scenario_bundle_runtime_js = (
            REPO_ROOT / "js" / "core" / "scenario" / "bundle_runtime.js"
        ).read_text(encoding="utf-8")
        scenario_apply_pipeline_js = (
            REPO_ROOT / "js" / "core" / "scenario_apply_pipeline.js"
        ).read_text(encoding="utf-8")
        scenario_post_apply_effects_js = (
            REPO_ROOT / "js" / "core" / "scenario_post_apply_effects.js"
        ).read_text(encoding="utf-8")
        scenario_manager_js = (REPO_ROOT / "js" / "core" / "scenario_manager.js").read_text(encoding="utf-8")
        scenario_bundle_loader_js = (
            REPO_ROOT / "js" / "core" / "scenario" / "bundle_loader.js"
        ).read_text(encoding="utf-8")
        ui_shell_debug_seed_js = (
            REPO_ROOT / "js" / "bootstrap" / "ui_shell_debug_seed.js"
        ).read_text(encoding="utf-8")

        self.assertIn('import { initPresetState } from "../core/preset_state.js";', render_runtime_binding_js)
        self.assertIn('from "./bootstrap/ui_shell_debug_seed.js";', main_js)
        self.assertNotRegex(main_js, r'import\s+\{\s*initSidebar')
        self.assertNotRegex(main_js, r'import\s+\{\s*initToolbar')
        self.assertNotRegex(main_js, r'import\s+\{\s*initShortcuts')
        self.assertIn('"../ui/toolbar.js"', deferred_ui_bootstrap_js)
        self.assertIn('"../ui/sidebar.js"', deferred_ui_bootstrap_js)
        self.assertIn('"../ui/shortcuts.js"', deferred_ui_bootstrap_js)
        self.assertIn('"first-visible-base"', startup_failure_recovery_js)
        self.assertIn('"first-visible-scenario"', main_js)
        self.assertIn('"bootstrap-first-political-frame"', main_js)
        self.assertIn("function checkpointFirstVisibleFrameMetrics()", main_js)
        self.assertIn('registerRuntimeHook(state, "noteFirstVisibleFramePaintedFn", checkpointFirstVisibleFrameMetrics);', main_js)
        self.assertIn("export function isUiShellDebugMode({ globalScope = globalThis } = {})", ui_shell_boot_js)
        self.assertIn('params.get("ui_shell") || params.get("startup_mode")', ui_shell_boot_js)
        self.assertIn('globalScope.__mapcreatorUiShellDebug = {', ui_shell_boot_js)
        self.assertIn('skippedStartupData: true,', ui_shell_boot_js)
        self.assertIn('skippedScenarioApply: true,', ui_shell_boot_js)
        self.assertIn('territoryPreview: uiShellTerritorySeed,', ui_shell_boot_js)
        self.assertIn('initPresetStateFn();', render_runtime_binding_js)
        self.assertLess(
            ui_shell_boot_js.index('const renderRuntime = helpers.createStartupRenderRuntimeBinding({'),
            ui_shell_boot_js.index('const uiShellTerritorySeed = helpers.applyUiShellDebugTerritorySeed();'),
        )
        self.assertLess(
            ui_shell_boot_js.index('const uiShellTerritorySeed = helpers.applyUiShellDebugTerritorySeed();'),
            ui_shell_boot_js.index('const startupUiBootstrapPromise = helpers.bootstrapDeferredUi(renderRuntime.renderApp);'),
        )
        self.assertLess(
            ui_shell_boot_js.index('await startupUiBootstrapPromise;'),
            ui_shell_boot_js.index('helpers.revealUiShellDebugTerritoryPanels();'),
        )
        self.assertLess(
            ui_shell_boot_js.index('helpers.runPostScenarioUiReplay({ full: true });'),
            ui_shell_boot_js.index('await helpers.ensureFullLocalizationDataReady({ reason: "ui-shell-ready", renderNow: false });'),
        )
        self.assertLess(
            ui_shell_boot_js.index('await helpers.ensureFullLocalizationDataReady({ reason: "ui-shell-ready", renderNow: false });'),
            ui_shell_boot_js.index('helpers.finishBootMetric("ui-shell", { mode: "debug" });'),
        )
        self.assertLess(
            main_js.index('invalidateAllRenderPasses("bootstrap-first-political-frame");'),
            main_js.index("void observeUiHydration();"),
        )
        self.assertIn('setBootPreviewVisibleState(state, active);', startup_boot_overlay_js)
        self.assertIn('import { createRenderDispatcher } from "./startup_bootstrap_support.js";', render_runtime_binding_js)
        self.assertIn('locales: payload?.base?.locales || null,', startup_bootstrap_support_js)
        self.assertIn('geoAliases: payload?.base?.geo_aliases || null,', startup_bootstrap_support_js)
        self.assertIn('data/scenarios/${normalizedScenarioId}/${normalizedFilename}', startup_bootstrap_support_js)
        self.assertNotIn('data/locales.startup.json', data_loader_js)
        self.assertNotIn('data/geo_aliases.startup.json', data_loader_js)
        self.assertIn('scenario-scoped', data_loader_js)
        self.assertNotIn('data/locales.startup.json', startup_cache_js)
        self.assertNotIn('data/geo_aliases.startup.json', startup_cache_js)
        self.assertIn('compactRuntimePoliticalMeta', startup_cache_js)
        self.assertIn('compactIndexedTagAssignmentPayload', startup_cache_js)
        self.assertIn('compactIndexedCoreAssignmentPayload', startup_cache_js)
        self.assertNotIn('./data_loader.js', startup_cache_js)
        self.assertIn('./runtime_asset_registry.js', startup_cache_js)
        self.assertIn('./runtime_asset_registry.js', data_loader_js)
        # Cached topology still needs worker decoding even when all resources hit.
        self.assertIn('if ((!topologyPrimary || !locales || !geoAliases || !decodedCollections) && workerEnabled)', data_loader_js)
        self.assertIn('cachedTopologyPrimary: topologyPrimary,', data_loader_js)
        self.assertIn('decodedCollections = workerResult.decodedCollections || null;', data_loader_js)
        self.assertIn('startupBootArtifacts && startupBootArtifacts.locales && startupBootArtifacts.geoAliases', data_loader_js)
        self.assertIn('needTopologyPrimary: !topologyPrimary,', data_loader_js)
        self.assertIn('needLocales: !locales,', data_loader_js)
        self.assertIn('needGeoAliases: !geoAliases,', data_loader_js)
        self.assertIn('topologyPrimary = topologyPrimary || workerResult.topologyPrimary || null;', data_loader_js)
        self.assertIn('startupWorkerUsed,', data_loader_js)
        self.assertIn('requestedBundleLevel === "bootstrap"', scenario_bundle_runtime_js)
        self.assertIn(
            ': manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""',
            scenario_bundle_runtime_js,
        )
        self.assertIn('async function ensureChunkedScenarioFirstFrameReady({', scenario_post_apply_effects_js)
        self.assertIn('const coarsePayload = await preloadScenarioCoarseChunks(bundle);', scenario_post_apply_effects_js)
        self.assertIn('awaitPrewarm: !deferChunkPrewarm', scenario_post_apply_effects_js)
        self.assertIn('coarsePrewarmDeferredAt: refreshScheduledAt', scenario_post_apply_effects_js)
        self.assertIn('chunkRefreshScheduledAt: refreshScheduledAt', scenario_post_apply_effects_js)
        self.assertIn('countryNames: staged.mapSemanticMode === "blank"', scenario_apply_pipeline_js)
        self.assertIn(': staged.scenarioNameMap,', scenario_apply_pipeline_js)
        self.assertNotIn('normalizeIndexedTagAssignmentPayload', scenario_manager_js)
        self.assertNotIn('normalizeIndexedCoreAssignmentPayload', scenario_manager_js)
        self.assertIn('normalizeIndexedTagAssignmentPayload', scenario_bundle_loader_js)
        self.assertIn('normalizeIndexedCoreAssignmentPayload', scenario_bundle_loader_js)
        self.assertIn('consumeStartupSupportKeyUsageAuditReport', startup_bootstrap_support_js)
        self.assertIn('from "../core/i18n.js"', startup_bootstrap_support_js)
        self.assertIn('/__dev/startup-support/key-usage-report', startup_bootstrap_support_js)
        self.assertIn('STARTUP_SUPPORT_AUDIT_PARAM', startup_bootstrap_support_js)
        self.assertIn('STARTUP_SUPPORT_AUDIT_LABEL_PARAM', startup_bootstrap_support_js)
        self.assertIn('sampleLabel', startup_bootstrap_support_js)
        self.assertIn('consumeStartupSupportKeyUsageAuditReport', (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8"))
        core_i18n_js = (REPO_ROOT / "js" / "core" / "i18n.js").read_text(encoding="utf-8")
        self.assertIn('setStartupSupportKeyUsageAuditEnabled', startup_bootstrap_support_js)
        self.assertNotIn('startup_support_audit', core_i18n_js)
        self.assertNotIn('globalThis.location', core_i18n_js)
        self.assertNotIn(
            "state.countryNames = {\n      ...countryNames,\n      ...staged.scenarioNameMap,\n    };",
            scenario_manager_js,
        )
        self.assertIn('const UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID = "ui_shell_territory_preview";', ui_shell_debug_seed_js)
        self.assertIn('const UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE = "GER";', ui_shell_debug_seed_js)
        self.assertIn('state.activeScenarioId = UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID;', ui_shell_debug_seed_js)
        self.assertIn('state.scenarioCountriesByTag = countries;', ui_shell_debug_seed_js)
        self.assertIn('state.scenarioReleasableIndex = buildPreviewReleasableIndex(countries);', ui_shell_debug_seed_js)
        self.assertIn('state.hierarchyGroupsByCode = new Map(', ui_shell_debug_seed_js)
        self.assertIn('state.ui.rightSidebarTab = "inspector";', ui_shell_debug_seed_js)
        self.assertIn('state.selectedInspectorCountryCode = UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE;', ui_shell_debug_seed_js)
        self.assertIn('documentRef.querySelector("[data-inspector-tab=\\"inspector\\"]");', ui_shell_debug_seed_js)
        self.assertIn("inspectorTabButton.click();", ui_shell_debug_seed_js)
        self.assertIn('makePreset("Rhineland Industrial Belt"', ui_shell_debug_seed_js)
        self.assertIn('makePreset("Austrian Core Territory"', ui_shell_debug_seed_js)
        self.assertIn('makePreset("Brittany Core Territory"', ui_shell_debug_seed_js)

    def test_ui_shell_debug_start_entry_uses_app_shell_without_startup_data(self) -> None:
        package_json = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        script = package_json["scripts"]["start:ui-shell"]
        self.assertIn("/app/?ui_shell=1&startup_interaction=full&startup_worker=0&startup_cache=0", script)
        self.assertIn("tools/dev_server.py", script)

        batch = (REPO_ROOT / "start_ui_shell_debug.bat").read_text(encoding="utf-8")
        self.assertIn("MAPCREATOR_OPEN_PATH=/app/?ui_shell=1&startup_interaction=full&startup_worker=0&startup_cache=0", batch)
        self.assertIn("MAPCREATOR_DEV_CACHE_MODE=nostore", batch)
        self.assertIn("call run_server.bat %*", batch)


if __name__ == "__main__":
    unittest.main()
