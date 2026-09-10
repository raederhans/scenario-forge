from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER = REPO_ROOT / "js" / "core" / "map_renderer.js"
OWNER = REPO_ROOT / "js" / "core" / "renderer" / "political_pass_orchestrator_owner.js"
PARTIAL_OWNER = REPO_ROOT / "js" / "core" / "renderer" / "political_partial_repaint_owner.js"
PUBLIC_FACADE = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"
STATE_WRITE_ALLOWLIST = REPO_ROOT / "tools" / "eslint-rules" / "state-writer-allowlist.json"
PASS_INVENTORY = REPO_ROOT / "tools" / "renderer_pass_family_inventory.mjs"

CANONICAL_OWNER_PATH = "js/core/renderer/political_pass_orchestrator_owner.js"


def extract_top_level_function(source, name):
    marker = f"function {name}("
    start = source.find(marker)
    if start < 0:
        raise AssertionError(f"missing function {name}")
    next_function = source.find("\nfunction ", start + len(marker))
    return source[start:] if next_function < 0 else source[start:next_function]


class MapRendererPoliticalPassOrchestratorBoundaryContractTest(unittest.TestCase):
    def test_canonical_owner_is_unique_and_map_renderer_keeps_a_thin_wrapper(self):
        renderer = MAP_RENDERER.read_text(encoding="utf-8")
        self.assertTrue(OWNER.is_file())
        self.assertIn(
            'import { createPoliticalPassOrchestratorOwner } from "./renderer/political_pass_orchestrator_owner.js";',
            renderer,
        )
        self.assertIn("let politicalPassOrchestratorOwner = null;", renderer)
        self.assertIn("function getPoliticalPassOrchestratorOwner() {", renderer)
        self.assertIn("politicalPassOrchestratorOwner = createPoliticalPassOrchestratorOwner({", renderer)
        self.assertRegex(
            renderer,
            re.compile(
                r"function drawPoliticalPass\(k\) \{\s*"
                r"return getPoliticalPassOrchestratorOwner\(\)\.drawPoliticalPass\(k\);\s*"
                r"\}",
            ),
        )
        duplicate_paths = (
            "js/core/renderer/political_pass_owner.js",
            "js/core/renderer/political_pass_helper.js",
            "js/core/renderer/political_pass_controller.js",
            "js/core/renderer/political_pass_adapter.js",
            "js/core/renderer/political_pass_orchestrator_helper.js",
            "js/core/renderer/political_pass_orchestrator_controller.js",
            "js/core/renderer/political_pass_orchestrator_adapter.js",
            "js/core/renderer/shared_political_pass_orchestrator_owner.js",
            "js/core/map_renderer/political_pass_orchestrator_owner.js",
        )
        self.assertEqual(
            [path for path in duplicate_paths if (REPO_ROOT / path).exists()],
            [],
        )

    def test_owner_is_import_free_and_excludes_root_algorithms_and_state_surfaces(self):
        source = OWNER.read_text(encoding="utf-8")
        self.assertNotRegex(source, re.compile(r"^\s*import\s", re.MULTILINE))
        for forbidden in (
            "runtimeState",
            "RendererRuntimeContext",
            "document.",
            "window.",
            "globalThis",
            "d3.",
            "getContext(",
            "drawPoliticalFeature(",
            "buildPoliticalRasterWorkerPacket(",
            "tryPartialPoliticalPassRepaint(",
            "orderPoliticalShellUnderlayFirst(",
            "invalidateRenderPasses(",
            "requestRendererRender(",
        ):
            self.assertNotIn(forbidden, source)
        for required in (
            "export function createPoliticalPassOrchestratorOwner({",
            "function resolveRecoveryQuality(",
            "function drawPoliticalPass(k)",
            "const identity = resolvePoliticalPassIdentity(k);",
            "const viewport = resolvePoliticalPassViewport(identity);",
            "const featureMetrics = drawPoliticalFineFeatureLoop({ k, identity, viewport });",
            "return Object.freeze({ drawPoliticalPass });",
        ):
            self.assertIn(required, source)

    def test_worker_fine_loop_and_partial_repaint_use_the_dedicated_owner_with_root_effects(self):
        renderer = MAP_RENDERER.read_text(encoding="utf-8")
        partial_owner = PARTIAL_OWNER.read_text(encoding="utf-8")
        identity = extract_top_level_function(partial_owner, "resolvePoliticalPassIdentity")
        viewport = extract_top_level_function(partial_owner, "resolvePoliticalPassViewport")
        diagnostics = extract_top_level_function(partial_owner, "publishPoliticalPassDiagnostics")
        request = extract_top_level_function(partial_owner, "requestPoliticalPassWorker")
        fine_loop = extract_top_level_function(partial_owner, "drawPoliticalFineFeatureLoop")
        partial_repaint = extract_top_level_function(partial_owner, "tryPartialPoliticalPassRepaint")
        recovery_quality = extract_top_level_function(renderer, "getPoliticalRecoveryQuality")

        self.assertIn("createPoliticalRasterWorkerIdentity({", identity)
        self.assertIn('passSignature: helper.getRenderPassSignature("political", transform),', identity)
        self.assertIn("collectVisibleLandSpatialItemsWithStats({ overscanPx: politicalOverscanPx })", viewport)
        self.assertIn("effect.commitPoliticalPassDiagnostics({", diagnostics)
        self.assertIn("runtimeState.politicalRecoveryQuality = resolved;", recovery_quality)
        self.assertIn("resolvePoliticalRecoveryQuality: getPoliticalRecoveryQuality,", renderer)

        composition = extract_top_level_function(renderer, "getPoliticalPartialRepaintOwner")
        callback_tokens = (
            'invalidateRenderPasses("political", "political-raster-worker-bitmap-ready");',
            'requestRendererRender("political-raster-worker-bitmap-ready", {',
            "fallback: () => render(),",
        )
        cursor = -1
        for token in callback_tokens:
            cursor = composition.find(token, cursor + 1)
            self.assertGreaterEqual(cursor, 0, token)

        for token in (
            "const hasVisibleItems = Array.isArray(viewport.visibleItems);",
            "const featureEntries = hasVisibleItems",
            "? viewport.visibleItems",
            ": state.landData.features.map",
            "drawPoliticalFeature(feature, drawOrder, {",
            "skipScreenCheck: hasVisibleItems",
            "orderPoliticalShellUnderlayFirst(featureEntries).forEach",
            "return featureMetrics;",
        ):
            self.assertIn(token, fine_loop)
        for token in (
            "collectLandSpatialItemsForProjectedRects(projectedDirtyRects, {",
            "drawPoliticalBackgroundFillsForEntries(redrawEntries)",
            "drawPoliticalFeature(feature, index, {",
            'paintSource: "political-partial-repaint"',
        ):
            self.assertIn(token, partial_repaint)

    def test_public_allowlist_catalogs_and_existing_owners_remain_independent(self):
        self.assertNotIn("political_pass_orchestrator_owner", PUBLIC_FACADE.read_text(encoding="utf-8"))
        self.assertNotIn(CANONICAL_OWNER_PATH, STATE_WRITE_ALLOWLIST.read_text(encoding="utf-8"))
        for relative_path in (
            "js/core/renderer/render_pipeline_catalog.js",
            "js/core/map_renderer/render_pass_catalog.js",
            "js/core/map_renderer/draw_canvas_orchestration_owner.js",
            "js/core/renderer/cached_pass_compositor_owner.js",
            "js/core/map_renderer/transformed_frame_compositor_owner.js",
            "js/core/renderer/visual_effects_pass_owner.js",
            "js/core/renderer/context_pass_orchestrator_owner.js",
        ):
            self.assertNotIn(
                "political_pass_orchestrator_owner",
                (REPO_ROOT / relative_path).read_text(encoding="utf-8"),
                relative_path,
            )

    def test_inventory_records_p3_3b_ownership_without_moving_the_entry_host(self):
        inventory = PASS_INVENTORY.read_text(encoding="utf-8")
        political_start = inventory.index('passName: "political"')
        political_end = inventory.index('passName: "hgoPreview"', political_start)
        political = inventory[political_start:political_end]
        self.assertIn('implementationStatus: "owned-p3"', political)
        self.assertIn('entryHostPath: "js/core/map_renderer.js"', political)
        self.assertIn('plannedPhase: "P3.3b"', political)
        self.assertIn(f'"{CANONICAL_OWNER_PATH}"', political)
        self.assertIn('"js/core/renderer/political_partial_repaint_owner.js"', political)
        self.assertIn("P3.5 partial repaint, packet, bitmap, identity, diagnostics, and fine traversal", political)


if __name__ == "__main__":
    unittest.main()
