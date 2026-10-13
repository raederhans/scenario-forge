from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
PUBLIC_FACADE_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"


def get_function_body(source, function_name):
    match = re.search(
        rf"function {re.escape(function_name)}\(\) \{{(?P<body>[\s\S]*?)\n\}}",
        source,
    )
    if match is None:
        raise AssertionError(f"Expected function {function_name} to exist")
    return match.group("body")


class MapRendererProjectionViewportContextBoundaryContractTest(unittest.TestCase):
    def test_projection_and_viewport_owners_receive_explicit_read_dependencies(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        projection_owner = get_function_body(renderer_content, "getRendererProjectionPathOwner")
        viewport_read_owner = get_function_body(renderer_content, "getViewportReadModelOwner")
        viewport_command_owner = get_function_body(renderer_content, "getViewportCommandOwner")

        for token in [
            "surfaceHost: rendererSurfaceHost,",
            "projectionPrecision: PROJECTION_PRECISION,",
            "pathPointRadius: PATH_POINT_RADIUS,",
            "getD3: () => globalThis.d3,",
        ]:
            self.assertIn(token, projection_owner)

        for token in [
            "mapPanPaddingPx: MAP_PAN_PADDING_PX,",
            "getViewportDimensions:",
            "getZoomTransformSnapshot:",
            "getPanContentBoundsSnapshots:",
            "getProjectedRenderableContentBoundsSnapshots:",
        ]:
            self.assertIn(token, viewport_read_owner)
        self.assertNotIn("state: runtimeState,", viewport_read_owner)

        for token in [
            "getViewportDimensions:",
            "minZoomScale: MIN_ZOOM_SCALE,",
            "maxZoomScale: MAX_ZOOM_SCALE,",
            "getZoomBehavior: () => rendererSurfaceHost.getZoomBehavior(),",
            "setZoomTransform: (transform) => {",
        ]:
            self.assertIn(token, viewport_command_owner)
        self.assertNotIn("state: runtimeState,", viewport_command_owner)

    def test_context_migration_does_not_leave_global_or_public_boundaries(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        public_content = PUBLIC_FACADE_JS.read_text(encoding="utf-8")

        self.assertNotIn("globalThis.rendererRuntimeContext", renderer_content)
        self.assertNotIn("runtimeState.rendererRuntimeContext", renderer_content)
        self.assertNotIn("renderer_runtime_context", renderer_content)
        self.assertNotIn("RendererRuntimeContext", public_content)


if __name__ == "__main__":
    unittest.main()
