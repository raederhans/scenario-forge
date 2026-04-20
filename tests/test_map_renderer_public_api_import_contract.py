from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    REPO_ROOT / "js" / "ui" / "sidebar.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace.js",
    REPO_ROOT / "js" / "core" / "scenario_ownership_editor.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace" / "district_editor_controller.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace" / "scenario_tag_creator_controller.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace" / "scenario_text_editors_controller.js",
]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"


class MapRendererPublicApiImportContractTest(unittest.TestCase):
    def test_app_consumers_use_named_renderer_imports(self):
        offenders = []
        namespace_calls = []

        for path in TARGETS:
            content = path.read_text(encoding="utf-8")
            if "import * as mapRenderer" in content:
                offenders.append(path.relative_to(REPO_ROOT).as_posix())
            if "mapRenderer." in content:
                namespace_calls.append(path.relative_to(REPO_ROOT).as_posix())

        self.assertEqual(offenders, [])
        self.assertEqual(namespace_calls, [])

    def test_map_renderer_export_block_keeps_grouped_public_facade_comments(self):
        content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn("// Batch 5 facade note:", content)
        self.assertIn("// Core render lifecycle facade.", content)
        self.assertIn("// Scenario refresh and color synchronization facade.", content)
        self.assertIn("// Strategic overlay editing facade.", content)
        self.assertIn("// Render cache and visual invalidation facade.", content)
        self.assertIn("// Dev workspace selection and fill facade.", content)
        self.assertIn("// Read-model helpers for UI, diagnostics, and export tooling.", content)
        self.assertIn("// Viewport, diagnostics, and render scheduling facade.", content)


if __name__ == "__main__":
    unittest.main()
