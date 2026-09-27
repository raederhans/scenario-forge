from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
RENDER_SNAPSHOT_JS = REPO_ROOT / "js" / "core" / "renderer" / "render_snapshot.js"


def get_function_body(source, function_name):
    match = re.search(
        rf"function {re.escape(function_name)}\([^)]*\) \{{(?P<body>[\s\S]*?)\n\}}",
        source,
    )
    if match is None:
        raise AssertionError(f"Expected function {function_name} to exist")
    return match.group("body")


class MapRendererRenderSnapshotBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_owns_one_snapshot_owner_and_read_only_facade(self):
        renderer = MAP_RENDERER_JS.read_text(encoding="utf-8")
        facade_body = get_function_body(renderer, "captureRenderSnapshot")

        self.assertEqual(
            renderer.count("const renderSnapshotOwner = createRenderSnapshotOwner();"),
            1,
        )
        self.assertIn(
            'import { createRenderSnapshotOwner } from "./renderer/render_snapshot.js";',
            renderer,
        )
        self.assertNotIn("function getRenderSnapshotOwner", renderer)
        self.assertIn("renderSnapshotOwner.captureRenderSnapshot(", facade_body)
        self.assertIn("captureRenderSnapshotState(runtimeState, {", facade_body)
        self.assertIn("getViewportRenderSignature", facade_body)
        self.assertIn("getProjectionRenderSignature", facade_body)
        self.assertIn("getViewportGeoBounds", facade_body)
        self.assertRegex(renderer, r"\n\s+captureRenderSnapshot,\n")

    def test_snapshot_module_is_declarative_only(self):
        snapshot = RENDER_SNAPSHOT_JS.read_text(encoding="utf-8")

        for token in [
            "sovereignBaseColors",
            "sovereigntyByFeatureId",
            "viewportRenderSignature",
            "projectionRenderSignature",
            "viewportGeoBounds",
        ]:
            self.assertIn(token, snapshot)

        for forbidden in [
            "history_manager",
            "pushHistoryEntry",
            "runtimeState",
            "requestRender",
            "render_boundary",
            "document.",
            "globalThis.d3",
        ]:
            self.assertNotIn(forbidden, snapshot)



if __name__ == "__main__":
    unittest.main()
