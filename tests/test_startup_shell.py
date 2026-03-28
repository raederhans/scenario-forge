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
            "data/locales.startup.json",
            "data/geo_aliases.startup.json",
            "data/scenarios/index.json",
            "data/scenarios/tno_1962/manifest.json",
        ]:
            self.assertIn(f'<link rel="preload" href="{href}" as="fetch" crossorigin />', html)

        self.assertNotIn('<script src="vendor/milsymbol.js"></script>', html)

    def test_main_bootstrap_uses_dynamic_ui_imports_and_boot_metrics(self) -> None:
        main_js = (REPO_ROOT / "js" / "main.js").read_text(encoding="utf-8")

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


if __name__ == "__main__":
    unittest.main()
