from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
PUBLIC_FACADE_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"
STATE_WRITE_ALLOWLIST = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"


def get_function_body(source, function_name):
    match = re.search(
        rf"function {re.escape(function_name)}\([^)]*\) \{{(?P<body>[\s\S]*?)\n\}}",
        source,
    )
    if match is None:
        raise AssertionError(f"Expected function {function_name} to exist")
    return match.group("body")


class MapRendererViewportMutationContextBoundaryContractTest(unittest.TestCase):
    def test_viewport_mutation_owners_receive_live_dependencies_at_the_root(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        update_owner = get_function_body(renderer_content, "getRendererViewportUpdateOwner")
        resize_owner = get_function_body(renderer_content, "getViewportResizeLifecycleOwner")

        for token in [
            "getViewportGroup: () => rendererSurfaceHost.getViewportGroup(),",
            "setZoomTransform: (transform) => {",
            "setZoomTransformState(runtimeState, transform);",
            "setHitCanvasDirty: () => {",
            "drawFrame: () => {",
        ]:
            self.assertIn(token, update_owner)

        for token in [
            "state: runtimeState,",
            "getMapContainer: () => rendererSurfaceHost.getMapContainer(),",
            "getGlobal: () => globalThis,",
            "getDevicePixelRatio: () => globalThis.devicePixelRatio,",
            "hasLandFeatures: () => !!runtimeState.landData?.features?.length,",
        ]:
            self.assertIn(token, resize_owner)

        for forbidden in [
            "getViewportReceiverContext",
            "getRendererRuntimeContext",
            "rendererRuntimeContext",
        ]:
            self.assertNotIn(forbidden, update_owner)
            self.assertNotIn(forbidden, resize_owner)

    def test_fit_projection_owner_receives_explicit_read_dependencies(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        fit_owner = get_function_body(renderer_content, "getRendererFitProjectionOwner")

        for token in [
            "surfaceHost: rendererSurfaceHost,",
            "state: runtimeState,",
            "projectionFitPaddingRatio: PROJECTION_FIT_PADDING_RATIO,",
            "getLogicalCanvasDimensions,",
            "getRenderableLandFeatures,",
            "resetCityAnchorCache: () => {",
            "setHitCanvasDirty: () => {",
        ]:
            self.assertIn(token, fit_owner)

        for forbidden in [
            "getViewportReceiverContext",
            "getRendererRuntimeContext",
            "rendererRuntimeContext",
        ]:
            self.assertNotIn(forbidden, fit_owner)

    def test_viewport_update_owner_uses_root_effects_and_group_getter(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        update_owner = get_function_body(renderer_content, "getRendererViewportUpdateOwner")
        owner_source = (
            REPO_ROOT / "js" / "core" / "renderer" / "renderer_viewport_update_owner.js"
        ).read_text(encoding="utf-8")

        for token in [
            "const runtime = runtimeState;",
            "getViewportGroup: () => rendererSurfaceHost.getViewportGroup(),",
            "setZoomTransformState(runtimeState, transform);",
            "setHitCanvasDirtyState(runtimeState, true);",
            "runtime.updateZoomUIFn",
            "drawCanvas();",
        ]:
            self.assertIn(token, update_owner)

        self.assertIn("const getViewportGroup = requireFunction(getters, \"getViewportGroup\", \"getters\");", owner_source)
        self.assertIn("const viewportGroup = getViewportGroup();", owner_source)
        self.assertIn("viewportGroup.attr(\"transform\"", owner_source)
        self.assertNotIn("getViewportReceiverContext", update_owner)
        self.assertNotIn("rendererRuntimeContext", update_owner)

    def test_resize_lifecycle_owner_uses_root_runtime_and_viewport_accessors(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        resize_owner = get_function_body(renderer_content, "getViewportResizeLifecycleOwner")

        for token in [
            "state: runtimeState,",
            "getMapContainer: () => rendererSurfaceHost.getMapContainer(),",
            "getGlobal: () => globalThis,",
            "getDevicePixelRatio: () => globalThis.devicePixelRatio,",
            "hasLandFeatures: () => !!runtimeState.landData?.features?.length,",
            "scheduleDeferredWork,",
            "cancelDeferredWork,",
            "nowMs,",
            "recordRenderPerfMetric,",
        ]:
            self.assertIn(token, resize_owner)

        self.assertNotIn("getViewportReceiverContext", resize_owner)
        self.assertNotIn("rendererRuntimeContext", resize_owner)

    def test_public_draw_pass_click_and_state_boundaries_remain_private(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        public_content = PUBLIC_FACADE_JS.read_text(encoding="utf-8")
        allowlist_content = STATE_WRITE_ALLOWLIST.read_text(encoding="utf-8")

        for token in [
            "function drawCanvas()",
            "function renderPassToCache(passName, drawFn, transform, timings)",
            "async function handleClick(event, interactionContext = null)",
            "return getClickSelectionTransactionOwner().handleClick(event, interactionContext);",
        ]:
            self.assertIn(token, renderer_content)

        render_pass_body = get_function_body(renderer_content, "renderPassToCache")
        for token in [
            "getRenderPassCacheHostOwner().prepareRenderPassHost({",
            "getRenderPassCommitAccountingOwner().commitRenderPass({",
            "hostSummary: hostResult,",
        ]:
            self.assertIn(token, render_pass_body)

        self.assertNotIn("RendererRuntimeContext", public_content)
        self.assertNotIn("renderer_runtime_context", public_content)
        self.assertNotIn("rendererRuntimeContext", allowlist_content)
        self.assertNotIn("renderer_runtime_context", allowlist_content)


if __name__ == "__main__":
    unittest.main()
