from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER = REPO_ROOT / "js" / "core" / "map_renderer.js"
OWNER = REPO_ROOT / "js" / "core" / "renderer" / "political_background_render_owner.js"
PARTIAL_OWNER = REPO_ROOT / "js" / "core" / "renderer" / "political_partial_repaint_owner.js"


class PoliticalBackgroundRenderOwnerBoundaryContractTest(unittest.TestCase):
    def test_owner_is_unique_and_root_facades_are_thin(self):
        renderer = MAP_RENDERER.read_text(encoding="utf-8")
        owner = OWNER.read_text(encoding="utf-8")
        self.assertIn(
            'import { createPoliticalBackgroundRenderOwner } from "./renderer/political_background_render_owner.js";',
            renderer,
        )
        self.assertIn("let politicalBackgroundRenderOwner = null;", renderer)
        self.assertIn("politicalBackgroundRenderOwner = createPoliticalBackgroundRenderOwner({", renderer)
        facades = {
            "drawBackgroundPass": "return getPoliticalBackgroundRenderOwner().drawBackgroundPass();",
            "drawPoliticalBackgroundFills": "return getPoliticalBackgroundRenderOwner().drawPoliticalBackgroundFills(options);",
            "drawPoliticalBackgroundFillsForEntries": (
                "return getPoliticalBackgroundRenderOwner().drawPoliticalBackgroundFillsForEntries(entries, options);"
            ),
            "cancelScenarioPoliticalBackgroundDeferredFullCache": (
                "return getPoliticalBackgroundRenderOwner().cancelScenarioPoliticalBackgroundDeferredFullCache(reason);"
            ),
        }
        for name, delegation in facades.items():
            match = re.search(rf"function {name}\([^)]*\) \{{(.*?)\n\}}", renderer, re.DOTALL)
            self.assertIsNotNone(match, name)
            self.assertEqual(match.group(1).strip(), delegation)

        moved = (
            "createScenarioPoliticalBackgroundCacheState",
            "getScenarioPoliticalBackgroundCacheKey",
            "buildPoliticalBackgroundResolvedGroups",
            "runScenarioPoliticalBackgroundDeferredFullCacheSlice",
            "scheduleScenarioPoliticalBackgroundDeferredFullCache",
            "buildScenarioPoliticalBackgroundEntries",
            "drawScenarioPoliticalBackgroundFills",
            "buildAdmin0MergedShapes",
            "drawAdmin0BackgroundFills",
            "drawOceanDepthMaskLayer",
        )
        for symbol in moved:
            self.assertRegex(owner, rf"function\s+{symbol}\s*\(")
            self.assertIsNone(re.search(rf"function\s+{symbol}\s*\(", renderer), symbol)
        self.assertRegex(renderer, r"function\s+buildCountryDominantFillColorMap\s*\(")
        self.assertRegex(renderer, r"function\s+getAdmin0BackgroundFillColor\s*\(")
        self.assertNotIn("function buildCountryDominantFillColorMap(", owner)
        self.assertIn("getAdmin0BackgroundFillColor(code)", owner)

    def test_owner_uses_injected_ports_and_preserves_p3_5_seam(self):
        renderer = MAP_RENDERER.read_text(encoding="utf-8")
        owner = OWNER.read_text(encoding="utf-8")
        partial_owner = PARTIAL_OWNER.read_text(encoding="utf-8")
        self.assertNotRegex(owner, re.compile(r"^\s*import\s", re.MULTILINE))
        for forbidden in ("runtimeState", "document.", "window.", "globalThis", "from \"../map_renderer"):
            self.assertNotIn(forbidden, owner)
        for symbol in (
            "getCachedPoliticalPassStaticSignature",
            "tryPartialPoliticalPassRepaint",
            "buildPoliticalRasterWorkerPacket",
        ):
            self.assertRegex(renderer, rf"function\s+{symbol}\s*\(")
            self.assertIsNone(re.search(rf"function\s+{symbol}\s*\(", owner), symbol)
        for symbol in ("tryPartialPoliticalPassRepaint", "buildPoliticalRasterWorkerPacket"):
            self.assertRegex(partial_owner, rf"function\s+{symbol}\s*\(")
        self.assertIn("requestPoliticalRasterWorkerPass,", renderer)
        self.assertNotIn("requestPoliticalRasterWorkerPass", owner)

    def test_cache_provenance_and_deferred_completion_order_are_source_bound(self):
        owner = OWNER.read_text(encoding="utf-8")
        for ordered_tokens in (
            ("return state.landDataFull || state.landData;",),
            (
                "isAtlantropaSeaFeature(feature)",
                "getSafeCanvasColor(state.colors?.[resolvedId], null)",
                "getResolvedFeatureColor(feature, resolvedId)",
                "LAND_FILL_COLOR",
            ),
            (
                "getDisplayOwnerCode(feature, resolvedId)",
                "getFeatureCountryCodeNormalized(feature)",
                '"__NONE__"',
            ),
            (
                "getScenarioPoliticalBackgroundFullPassGroups(normalizedEntries",
                'recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheComplete"',
                "scenarioPoliticalBackgroundDeferredFullCacheState = null;",
                'invalidateRenderPasses("political", "progressive-political-full-cache-ready")',
                "recordProgressivePoliticalFullCacheReadyDiagnostics(getRuntimeState()",
                'requestRendererRender("progressive-political-full-cache-ready"',
            ),
        ):
            cursor = -1
            for token in ordered_tokens:
                cursor = owner.find(token, cursor + 1)
                self.assertGreaterEqual(cursor, 0, token)

    def test_background_and_progressive_draw_order_stay_explicit(self):
        owner = OWNER.read_text(encoding="utf-8")
        background = owner[owner.index("function drawBackgroundPass()") :]
        cursor = -1
        for token in ('{ type: "Sphere" }', "surface.getContext().fill();", "drawOceanStyle();", "drawOceanDepthMaskLayer();"):
            cursor = background.find(token, cursor + 1)
            self.assertGreaterEqual(cursor, 0, token)
        self.assertNotIn("state.oceanData", background)
        progressive = owner[owner.index("if (useProgressiveRecovery)") : owner.index("    return drawPoliticalBackgroundFillsForEntries(visibleEntries", owner.index("if (useProgressiveRecovery)"))]
        self.assertNotIn("drawAdmin0BackgroundFills(", progressive)
        cursor = -1
        for token in (
            "scheduleScenarioPoliticalBackgroundDeferredFullCache(visibleEntries",
            'recordRenderPerfMetric("scenarioPoliticalBackgroundProgressiveRecovery"',
            "coarseUnderlay: \"scenario-features\"",
        ):
            cursor = progressive.find(token, cursor + 1)
            self.assertGreaterEqual(cursor, 0, token)
        self.assertIn("try {", owner[owner.index("function drawOceanDepthMaskLayer") :])
        self.assertIn("finally {", owner[owner.index("function drawOceanDepthMaskLayer") :])


if __name__ == "__main__":
    unittest.main()
