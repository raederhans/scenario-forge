from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "draw_canvas_orchestration_owner.js"
PUBLIC_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"
STATE_WRITE_ALLOWLIST = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"
ARCHITECTURE_TOOL = REPO_ROOT / "tools" / "check_architecture_boundaries.mjs"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_function(source: str, name: str) -> str:
    marker = f"function {name}("
    start = source.find(marker)
    assert start >= 0, f"missing function {name}"
    body_start = source.find("{", start)
    depth = 0
    for index in range(body_start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise AssertionError(f"unclosed function {name}")


class DrawCanvasOrchestrationOwnerBoundaryContract(unittest.TestCase):
    def test_canonical_owner_exists_and_duplicate_owner_names_are_forbidden(self):
        self.assertTrue(OWNER_JS.exists())
        forbidden = [
            "js/core/map_renderer/draw_canvas_orchestration_helper.js",
            "js/core/map_renderer/draw_canvas_orchestration_controller.js",
            "js/core/map_renderer/draw_canvas_orchestration_adapter.js",
            "js/core/map_renderer/shared_draw_canvas_orchestration_owner.js",
            "js/core/renderer/draw_canvas_orchestration_owner.js",
            "js/core/renderer/draw_canvas_orchestration_helper.js",
            "js/core/renderer/draw_canvas_orchestration_controller.js",
            "js/core/renderer/draw_canvas_orchestration_adapter.js",
            "js/core/renderer/renderer_render_lifecycle_owner.js",
        ]
        for relative in forbidden:
            self.assertFalse((REPO_ROOT / relative).exists(), relative)

        for path in (REPO_ROOT / "js" / "core").rglob("*.js"):
            relative = path.relative_to(REPO_ROOT).as_posix()
            if relative == "js/core/map_renderer/draw_canvas_orchestration_owner.js":
                continue
            stem = path.stem.lower().replace("-", "_")
            compact = stem.replace("_", "")
            if "drawcanvas" in compact and ("orchestration" in compact or "orchestrator" in compact):
                self.assertNotRegex(stem, r"(?:^|_)(?:owner|helper|controller|adapter)(?:_|$)", relative)

    def test_owner_is_import_free_and_has_json_safe_boundary(self):
        owner = read(OWNER_JS)
        self.assertIn("export function createDrawCanvasOrchestrationOwner({ constants = {}, getters = {}, effects = {} } = {})", owner)
        self.assertIn("return Object.freeze({\n    drawCanvasFrame,\n  });", owner)
        self.assertIn("function drawCanvasFrame(options)", owner)
        self.assertIn("const includeSummary = options?.includeSummary === true;", owner)
        self.assertNotIn("function drawCanvasFrame(options = {})", owner)
        self.assertIn("function cloneJsonSafeTimings(timings)", owner)
        self.assertIn("timings: cloneJsonSafeTimings(timings)", owner)
        self.assertIn("getRenderPhase() === renderPhaseInteracting && getFirstVisibleFramePainted()", owner)
        self.assertNotIn("effectOrder", owner)
        self.assertNotIn("getterOrder", owner)
        self.assertNotIn("createTrace", owner)
        self.assertNotRegex(owner, r"(?m)^\s*import\s")
        forbidden_tokens = [
            "map_renderer.js",
            "RendererRuntimeContext",
            "global" + "This",
            "document",
            "window",
            "runtime" + "State",
            "getRenderPassCacheState",
            "cloneZoomTransform",
            "renderPassToCache",
            "drawPoliticalPass",
        ]
        for token in forbidden_tokens:
            self.assertNotIn(token, owner)
        self.assertLessEqual(len(owner.splitlines()), 320)

    def test_map_renderer_is_thin_wrapper_and_composition_root(self):
        renderer = read(MAP_RENDERER_JS)
        wrapper = extract_function(renderer, "drawCanvas")
        self.assertEqual(wrapper, "function drawCanvas() {\n  getDrawCanvasOrchestrationOwner().drawCanvasFrame();\n}")
        self.assertIn('import { createDrawCanvasOrchestrationOwner } from "./map_renderer/draw_canvas_orchestration_owner.js";', renderer)
        self.assertIn("function getDrawCanvasOrchestrationOwner() {", renderer)
        self.assertIn("getEffectiveZoomTransform: () => runtimeState.zoomTransform || globalThis.d3.zoomIdentity", renderer)
        self.assertIn("getRawZoomTransform: () => runtimeState.zoomTransform", renderer)
        self.assertRegex(
            renderer,
            re.compile(
                r"commitLastFrame:\s*\(\{ phase, totalMs, timings, transform, frameMode, presented = true \}\) => \{\s*"
                r"const cache = getRenderPassCacheState\(\);\s*cache\.lastFrame = \{\s*"
                r"phase,\s*totalMs,\s*timings,\s*frameMode,\s*presented,\s*"
                r"targetTransform: cloneZoomTransform\(transform\),\s*"
                r"transform: presented \? cloneZoomTransform\(transform\) : cache\.lastFrame\?\.transform,\s*"
                r"\};\s*if \(presented\) getRendererViewportUpdateOwner\(\)\.applyViewportTransform\(transform\);\s*\}",
                re.S,
            ),
        )
        self.assertEqual(renderer.count("function drawCanvas()"), 1)
        self.assertEqual(renderer.count("getDrawCanvasOrchestrationOwner().drawCanvasFrame();"), 1)
        self.assertLessEqual(len(renderer.splitlines()), 23437)

    def test_owner_keeps_required_dependency_surface(self):
        owner = read(OWNER_JS)
        for token in [
            "isFrameSurfaceReady",
            "getRenderPhase",
            "getDeferExactAfterSettle",
            "getFirstVisibleFramePainted",
            "getEffectiveZoomTransform",
            "getRawZoomTransform",
            "getActiveScenarioId",
            "getActiveRenderPassNames",
            "ensureLayerDataFromTopology",
            "drawTransformedFrameFromCaches",
            "drawLastGoodFrameFallback",
            "noteMissingVisibleFrameSkippedDuringInteraction",
            "drawBaseVisibleFrameFallback",
            "resetContextBreakdownForExactFrame",
            "ensureIdleRenderPasses",
            "composeCachedPasses",
            "abortPendingExactAfterSettleRefreshAfterPaint",
            "commitLastFrame",
            "markFirstVisibleFramePainted",
            "captureLastGoodFrame",
            "recordRenderPerfMetric",
            "finalizePendingExactAfterSettleRefreshAfterPaint",
        ]:
            self.assertIn(token, owner)
        self.assertLess(owner.index('"drawCanvas"'), owner.index('"frames"'))
        self.assertLess(owner.index('"drawCanvas-stale-overlay"'), owner.index('"drawCanvas-non-idle"'))
        self.assertLess(owner.index('"compose-cached-passes-failed"'), owner.index('"lastGoodFrameCaptureSkipped"'))

    def test_public_and_state_write_surfaces_do_not_expose_owner(self):
        token = "draw_canvas_orchestration_owner"
        self.assertNotIn(token, read(PUBLIC_JS))
        self.assertNotIn(token, read(STATE_WRITE_ALLOWLIST))
        self.assertIn("drawCanvasOrchestrationOwner", read(ARCHITECTURE_TOOL))


if __name__ == "__main__":
    unittest.main()
