from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER = REPO_ROOT / "js" / "core" / "map_renderer.js"
OWNER = REPO_ROOT / "js" / "core" / "renderer" / "political_partial_repaint_owner.js"
WORKER_CLIENT = REPO_ROOT / "js" / "core" / "political_raster_worker_client.js"


def extract_function(source, name):
    marker = f"function {name}("
    start = source.find(marker)
    if start < 0:
        raise AssertionError(f"missing function {name}")
    next_function = source.find("\nfunction ", start + len(marker))
    return source[start:] if next_function < 0 else source[start:next_function]


class PoliticalPartialRepaintOwnerBoundaryContractTest(unittest.TestCase):
    def test_owner_is_import_free_and_root_facades_are_thin(self):
        renderer = MAP_RENDERER.read_text(encoding="utf-8")
        owner = OWNER.read_text(encoding="utf-8")
        self.assertNotRegex(owner, re.compile(r"^\s*import\s", re.MULTILINE))
        for token in ("runtimeState", "document.", "window.", "globalThis", "new Worker(", "setTimeout("):
            self.assertNotIn(token, owner)
        self.assertIn(
            'import { createPoliticalPartialRepaintOwner } from "./renderer/political_partial_repaint_owner.js";',
            renderer,
        )
        self.assertIn("politicalPartialRepaintOwner = createPoliticalPartialRepaintOwner({", renderer)
        facades = {
            "tryPartialPoliticalPassRepaint": (
                "exactCompositeReuseOwner?.invalidate();\n"
                "  return getPoliticalPartialRepaintOwner().tryPartialPoliticalPassRepaint(transform, nextSignature, timings);"
            ),
            "resolvePoliticalPassIdentity": "return getPoliticalPartialRepaintOwner().resolvePoliticalPassIdentity(k);",
            "resolvePoliticalPassViewport": "return getPoliticalPartialRepaintOwner().resolvePoliticalPassViewport(identity);",
            "requestPoliticalPassWorker": "return getPoliticalPartialRepaintOwner().requestPoliticalPassWorker({ identity, packetState });",
            "drawPoliticalFineFeatureLoop": "return getPoliticalPartialRepaintOwner().drawPoliticalFineFeatureLoop({ k, identity, viewport });",
        }
        for name, delegation in facades.items():
            self.assertRegex(
                renderer,
                re.compile(rf"function {name}\([^\n]*\) \{{\s*{re.escape(delegation)}\s*\}}"),
            )

    def test_owner_holds_partial_worker_and_fine_algorithms(self):
        owner = OWNER.read_text(encoding="utf-8")
        for name in (
            "buildPoliticalRasterWorkerPacket",
            "drawPoliticalWorkerBitmapResult",
            "tryPartialPoliticalPassRepaint",
            "recordPoliticalRasterWorkerSnapshot",
            "resolvePoliticalPassIdentity",
            "resolvePoliticalPassViewport",
            "publishPoliticalPassDiagnostics",
            "requestPoliticalPassWorker",
            "drawPoliticalFineFeatureLoop",
        ):
            self.assertIn(f"function {name}(", owner)
        partial = extract_function(owner, "tryPartialPoliticalPassRepaint")
        self.assertIn('String(cache.reasons?.political || "") !== "refresh-colors"', partial)
        self.assertIn('fallback("missing-full-reference-transform")', partial)
        self.assertIn("cache.partialPoliticalDirtyIds.clear();", partial)
        self.assertGreater(partial.rindex("cache.partialPoliticalDirtyIds.clear();"), partial.index("effect.withRenderTarget"))

    def test_worker_protocol_singleton_and_accepted_scheduler_stay_in_existing_authorities(self):
        renderer = MAP_RENDERER.read_text(encoding="utf-8")
        owner = OWNER.read_text(encoding="utf-8")
        client = WORKER_CLIENT.read_text(encoding="utf-8")
        self.assertIn("POLITICAL_RASTER_WORKER_PROTOCOL_VERSION = 4", client)
        self.assertIn("let workerInstance = null;", client)
        self.assertIn("const POLITICAL_RASTER_WORKER_TIMEOUT_MS = 1800;", client)
        self.assertNotIn("politicalRasterWorkerClient", owner)
        composition = extract_function(renderer, "getPoliticalPartialRepaintOwner")
        ordered = (
            'invalidateRenderPasses("political", "political-raster-worker-bitmap-ready");',
            'requestRendererRender("political-raster-worker-bitmap-ready", {',
            "fallback: () => render(),",
        )
        cursor = -1
        for token in ordered:
            cursor = composition.find(token, cursor + 1)
            self.assertGreaterEqual(cursor, 0, token)


if __name__ == "__main__":
    unittest.main()
