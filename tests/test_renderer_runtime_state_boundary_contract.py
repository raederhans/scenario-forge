from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
RENDERER_RUNTIME_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "renderer_runtime_state.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"


class RendererRuntimeStateBoundaryContractTest(unittest.TestCase):
    def test_renderer_runtime_state_owner_exports_shared_factories(self):
        owner_content = RENDERER_RUNTIME_STATE_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultRendererInfrastructureState", owner_content)
        self.assertIn("createDefaultRenderPassCacheState", owner_content)
        self.assertIn("createDefaultSidebarPerfState", owner_content)
        self.assertIn("createDefaultProjectedBoundsCacheState", owner_content)
        self.assertIn("createDefaultProjectedBoundsDiagnostics", owner_content)
        self.assertIn("createDefaultRendererTransientRuntimeState", owner_content)

    def test_map_renderer_reuses_renderer_runtime_factories(self):
        content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn("./state/renderer_runtime_state.js", content)
        self.assertIn("createDefaultRenderPassCacheState()", content)
        self.assertIn("createDefaultSidebarPerfState()", content)
        self.assertIn("createDefaultProjectedBoundsCacheState()", content)
        self.assertIn("createDefaultProjectedBoundsDiagnostics()", content)

    def test_sidebar_reuses_sidebar_perf_factory(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("../core/state/renderer_runtime_state.js", content)
        self.assertIn("createDefaultSidebarPerfState()", content)


if __name__ == "__main__":
    unittest.main()
