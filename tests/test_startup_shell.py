from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class StartupShellTest(unittest.TestCase):
    def test_index_html_keeps_startup_preloads_and_deferred_milsymbol(self) -> None:
        html = (REPO_ROOT / "index.html").read_text(encoding="utf-8")

        self.assertIn('<meta name="default-scenario" content="tno_1962" />', html)
        for href in [
            "data/europe_topology.json",
            "data/scenarios/index.json",
        ]:
            self.assertIn(f'<link rel="preload" href="{href}" as="fetch" crossorigin />', html)
        self.assertNotIn('href="data/scenarios/tno_1962/manifest.json"', html)
        self.assertNotIn('href="data/locales.startup.json"', html)
        self.assertNotIn('href="data/geo_aliases.startup.json"', html)
        self.assertIn('<link rel="modulepreload" href="js/main.js" />', html)

        self.assertNotIn('<script src="vendor/milsymbol.js"></script>', html)

    def test_main_bootstrap_uses_dynamic_ui_imports_and_boot_metrics(self) -> None:
        main_js = (REPO_ROOT / "js" / "main.js").read_text(encoding="utf-8")
        data_loader_js = (REPO_ROOT / "js" / "core" / "data_loader.js").read_text(encoding="utf-8")
        startup_cache_js = (REPO_ROOT / "js" / "core" / "startup_cache.js").read_text(encoding="utf-8")
        scenario_resources_js = (REPO_ROOT / "js" / "core" / "scenario_resources.js").read_text(encoding="utf-8")
        scenario_post_apply_effects_js = (
            REPO_ROOT / "js" / "core" / "scenario_post_apply_effects.js"
        ).read_text(encoding="utf-8")
        scenario_manager_js = (REPO_ROOT / "js" / "core" / "scenario_manager.js").read_text(encoding="utf-8")

        self.assertIn('import { initPresetState } from "./core/preset_state.js";', main_js)
        self.assertNotRegex(main_js, r'import\s+\{\s*initSidebar')
        self.assertNotRegex(main_js, r'import\s+\{\s*initToolbar')
        self.assertNotRegex(main_js, r'import\s+\{\s*initShortcuts')
        self.assertIn('import("./ui/toolbar.js")', main_js)
        self.assertIn('import("./ui/sidebar.js")', main_js)
        self.assertIn('import("./ui/shortcuts.js")', main_js)
        self.assertIn('"first-visible-base"', main_js)
        self.assertIn('"first-visible-scenario"', main_js)
        self.assertIn('state.bootPreviewVisible = !!active;', main_js)
        self.assertIn('data/scenarios/${normalizedScenarioId}/${normalizedFilename}', main_js)
        self.assertNotIn('data/locales.startup.json', data_loader_js)
        self.assertNotIn('data/geo_aliases.startup.json', data_loader_js)
        self.assertIn('scenario-scoped', data_loader_js)
        self.assertNotIn('data/locales.startup.json', startup_cache_js)
        self.assertNotIn('data/geo_aliases.startup.json', startup_cache_js)
        self.assertIn('if ((!topologyPrimary || !locales || !geoAliases) && workerEnabled)', data_loader_js)
        self.assertIn('needTopologyPrimary: !topologyPrimary,', data_loader_js)
        self.assertIn('needLocales: !locales,', data_loader_js)
        self.assertIn('needGeoAliases: !geoAliases,', data_loader_js)
        self.assertIn('topologyPrimary = topologyPrimary || workerResult.topologyPrimary || null;', data_loader_js)
        self.assertIn('startupWorkerUsed,', data_loader_js)
        self.assertIn('requestedBundleLevel === "bootstrap"', scenario_resources_js)
        self.assertIn(
            ': manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""',
            scenario_resources_js,
        )
        self.assertIn('async function ensureChunkedScenarioFirstFrameReady({', scenario_post_apply_effects_js)
        self.assertIn('await preloadScenarioCoarseChunks(bundle);', scenario_post_apply_effects_js)
        self.assertIn('await ensureChunkedScenarioFirstFrameReady({ bundle, scenarioId });', scenario_post_apply_effects_js)
        self.assertIn('state.countryNames = staged.mapSemanticMode === "blank"', scenario_manager_js)
        self.assertIn(': { ...staged.scenarioNameMap };', scenario_manager_js)
        self.assertNotIn(
            "state.countryNames = {\n      ...countryNames,\n      ...staged.scenarioNameMap,\n    };",
            scenario_manager_js,
        )


if __name__ == "__main__":
    unittest.main()
