from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
CACHED_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "cached_pass_compositor_owner.js"
TRANSFORMED_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "transformed_frame_compositor_owner.js"
PUBLIC_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"
STATE_WRITE_ALLOWLIST = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_function(source: str, name: str) -> str:
    marker = f"function {name}("
    start = source.find(marker)
    assert start >= 0, f"missing function {name}"
    signature_end = re.search(r"\)\s*\{", source[start:])
    assert signature_end is not None, f"missing function body for {name}"
    body_start = start + signature_end.end() - 1
    depth = 0
    for index in range(body_start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise AssertionError(f"unclosed function {name}")


class FrameCompositorOwnerBoundaryContract(unittest.TestCase):
    def test_cached_owner_is_canonical_bounded_and_unique(self):
        self.assertTrue(CACHED_OWNER_JS.exists())
        source = read(CACHED_OWNER_JS)
        self.assertIn(
            "export function createCachedPassCompositorOwner({ constants = {}, getters = {}, helpers = {}, effects = {} } = {})",
            source,
        )
        self.assertEqual(re.findall(r'from "([^"]+)"', source), ["./cached_surface_coverage.js"])
        for token in [
            "map_renderer.js",
            "RendererRuntimeContext",
            "runtime" + "State",
            "global" + "This",
            "document",
            "window",
            "getRenderPassCacheState",
            "runGetter",
            "runEffect",
            "createTrace",
            "getPassCanvas",
            "isPassDirty",
        ]:
            self.assertNotIn(token, source)
        self.assertEqual(source.count("const cacheSnapshot = getRenderPassCacheSnapshot();"), 2)
        self.assertIn("{ requireAllPasses = false, targetOffsetX = 0, targetOffsetY = 0 } = {},", source)
        self.assertNotIn("options?.requireAllPasses", source)
        self.assertLessEqual(len(source.splitlines()), 320)

        forbidden = [
            "js/core/renderer/cached_pass_compositor_helper.js",
            "js/core/renderer/cached_pass_compositor_controller.js",
            "js/core/renderer/cached_pass_compositor_adapter.js",
            "js/core/renderer/shared_cached_pass_compositor_owner.js",
            "js/core/map_renderer/cached_pass_compositor_owner.js",
            "js/core/map_renderer/cached_pass_compositor_helper.js",
            "js/core/map_renderer/cached_pass_compositor_controller.js",
            "js/core/map_renderer/cached_pass_compositor_adapter.js",
        ]
        for relative in forbidden:
            self.assertFalse((REPO_ROOT / relative).exists(), relative)

    def test_transformed_owner_is_canonical_bounded_and_unique(self):
        self.assertTrue(TRANSFORMED_OWNER_JS.exists())
        source = read(TRANSFORMED_OWNER_JS)
        self.assertIn(
            "export function createTransformedFrameCompositorOwner({",
            source,
        )
        self.assertNotRegex(source, r"(?m)^\s*import\s")
        for token in [
            "map_renderer.js",
            "RendererRuntimeContext",
            "runtime" + "State",
            "global" + "This",
            "document",
            "window",
            "runGetter",
            "runEffect",
            "createTrace",
        ]:
            self.assertNotIn(token, source)
        for token in [
            "function composeTransformedFrameToBuffer(",
            "function drawTransformedFrameFromCaches(",
            "setInteractionCompositeRejectedReason(compositeReuseDecision.reason || \"unknown\")",
            "setPendingExactPoliticalFastFrame(false)",
            "blitCompositeBufferToMain(bufferCanvas)",
            "return Object.freeze({",
        ]:
            self.assertIn(token, source)
        self.assertLessEqual(len(source.splitlines()), 420)

        forbidden = [
            "js/core/map_renderer/transformed_frame_compositor_helper.js",
            "js/core/map_renderer/transformed_frame_compositor_controller.js",
            "js/core/map_renderer/transformed_frame_compositor_adapter.js",
            "js/core/map_renderer/shared_transformed_frame_compositor_owner.js",
            "js/core/renderer/transformed_frame_compositor_owner.js",
            "js/core/renderer/transformed_frame_compositor_helper.js",
            "js/core/renderer/transformed_frame_compositor_controller.js",
            "js/core/renderer/transformed_frame_compositor_adapter.js",
        ]
        for relative in forbidden:
            self.assertFalse((REPO_ROOT / relative).exists(), relative)

    def test_map_renderer_keeps_thin_wrappers_and_composition_root_writes(self):
        renderer = read(MAP_RENDERER_JS)
        self.assertIn(
            'import { createCachedPassCompositorOwner } from "./renderer/cached_pass_compositor_owner.js";',
            renderer,
        )
        self.assertIn("let cachedPassCompositorOwner = null;", renderer)
        self.assertIn("function getCachedPassCompositorOwner() {", renderer)
        self.assertIn("getActiveTargetContext: () => rendererSurfaceHost.getContext()", renderer)
        self.assertIn("getRenderPassCacheSnapshot: getRenderPassCacheState", renderer)
        self.assertIn("recordTransformedPassDiagnostics:", renderer)

        owner_getter = extract_function(renderer, "getCachedPassCompositorOwner")
        self.assertEqual(owner_getter.count("getRenderPassCacheSnapshot: getRenderPassCacheState"), 1)
        self.assertNotIn("getPassCanvas:", owner_getter)
        self.assertNotIn("isPassDirty:", owner_getter)

        draw_wrapper = extract_function(renderer, "drawTransformedPass")
        self.assertRegex(
            draw_wrapper,
            re.compile(
                r"return getCachedPassCompositorOwner\(\)\.drawTransformedPass\(\s*"
                r"passName,\s*currentTransform,\s*referenceTransform,?\s*\);",
                re.S,
            ),
        )
        self.assertNotIn("scaleRatio", draw_wrapper)
        self.assertNotIn("renderDiag", draw_wrapper)

        compose_wrapper = extract_function(renderer, "composeRenderPassesToTarget")
        self.assertIn("return getCachedPassCompositorOwner().composeRenderPassesToTarget(", compose_wrapper)
        self.assertIn("options,", compose_wrapper)
        self.assertNotIn("{ requireAllPasses }", compose_wrapper)
        for token in [
            "missingCanvasPassNames",
            "missingReferenceTransformPassNames",
            "scaleRatio",
            "targetContext.save()",
            "targetContext.drawImage(",
        ]:
            self.assertNotIn(token, compose_wrapper)

        export_wrapper = extract_function(renderer, "renderExportPassesToCanvas")
        self.assertIn("composeRenderPassesToTarget(exportContext, passNames,", export_wrapper)
        self.assertNotIn("getCachedPassCompositorOwner()", export_wrapper)

        self.assertIn(
            'import { createTransformedFrameCompositorOwner } from "./map_renderer/transformed_frame_compositor_owner.js";',
            renderer,
        )
        self.assertIn("let transformedFrameCompositorOwner = null;", renderer)
        transformed_owner_getter = extract_function(renderer, "getTransformedFrameCompositorOwner")
        for token in [
            "createTransformedFrameCompositorOwner({",
            "getCurrentTransform: () => runtimeState.zoomTransform || globalThis.d3.zoomIdentity",
            "getRenderPassCacheSnapshot: getRenderPassCacheState",
            "setInteractionCompositeRejectedReason: (reason) => {",
            "getRenderPassCacheState().interactionComposite.rejectedReason = reason;",
            "setPendingExactPoliticalFastFrame: (value) => {",
            "setPendingExactPoliticalFastFrameState(runtimeState, value);",
        ]:
            self.assertIn(token, transformed_owner_getter)

        buffer_wrapper = extract_function(renderer, "composeTransformedFrameToBuffer")
        self.assertIn(
            "return getTransformedFrameCompositorOwner().composeTransformedFrameToBuffer(",
            buffer_wrapper,
        )
        frame_wrapper = extract_function(renderer, "drawTransformedFrameFromCaches")
        self.assertIn(
            "return getTransformedFrameCompositorOwner().drawTransformedFrameFromCaches(timings, options);",
            frame_wrapper,
        )
        for wrapper in [buffer_wrapper, frame_wrapper]:
            for token in [
                "allowDirtyFastFrame",
                "getInteractionCompositeReuseDecision",
                "buildInteractionComposite(",
                "drawInteractionBorderSnapshot(",
                "pendingExactPoliticalFastFrame =",
            ]:
                self.assertNotIn(token, wrapper)

    def test_adjacent_frame_algorithms_and_public_surfaces_stay_in_place(self):
        renderer = read(MAP_RENDERER_JS)
        for function_name in [
            "buildInteractionComposite",
            "drawInteractionComposite",
            "drawInteractionBorderSnapshot",
            "drawBordersPass",
            "drawLastGoodFrameFallback",
            "drawBaseVisibleFrameFallback",
            "renderPassToCache",
        ]:
            self.assertEqual(renderer.count(f"function {function_name}("), 1, function_name)
        for token in [
            "cached_pass_compositor_owner",
            "cachedPassCompositorOwner",
            "transformed_frame_compositor_owner",
            "transformedFrameCompositorOwner",
        ]:
            self.assertNotIn(token, read(PUBLIC_JS))
            self.assertNotIn(token, read(STATE_WRITE_ALLOWLIST))

    def test_map_renderer_budget_moves_down_without_format_compaction(self):
        renderer = read(MAP_RENDERER_JS)
        self.assertLessEqual(len(renderer.splitlines()), 23280)


if __name__ == "__main__":
    unittest.main()
