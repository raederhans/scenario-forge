from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
SNAPSHOT_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "interaction_border_snapshot_owner.js"


class MapRendererInteractionBorderSnapshotOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_border_snapshot_facade_while_snapshot_logic_moves_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = SNAPSHOT_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createInteractionBorderSnapshotOwner } from './renderer/interaction_border_snapshot_owner.js';",
            renderer_imports,
        )
        self.assertIn("let interactionBorderSnapshotOwner = null;", renderer_content)
        self.assertIn("function getInteractionBorderSnapshotOwner() {", renderer_content)
        self.assertIn("getRenderPassCacheState,", renderer_content)
        self.assertIn("cloneZoomTransform,", renderer_content)
        self.assertIn("drawBordersPass,", renderer_content)
        self.assertIn("prepareTargetContext,", renderer_content)
        self.assertIn("withRenderTarget,", renderer_content)
        self.assertIn("return getInteractionBorderSnapshotOwner().buildInteractionBorderSnapshotLayout();", renderer_content)
        self.assertIn("return getInteractionBorderSnapshotOwner().getInteractionBorderSnapshotState();", renderer_content)
        self.assertIn("return getInteractionBorderSnapshotOwner().ensureInteractionBorderSnapshotCanvas();", renderer_content)
        self.assertIn("return getInteractionBorderSnapshotOwner().invalidateInteractionBorderSnapshot(reason);", renderer_content)
        self.assertIn("return getInteractionBorderSnapshotOwner().captureInteractionBorderSnapshot(transform);", renderer_content)
        self.assertIn("return getInteractionBorderSnapshotOwner().drawInteractionBorderSnapshot(currentTransform);", renderer_content)
        self.assertIn("function drawBordersPass(k, { interactive = false } = {}) {", renderer_content)

        self.assertIn("export function createInteractionBorderSnapshotOwner({", owner_content)
        self.assertIn("function buildInteractionBorderSnapshotLayout() {", owner_content)
        self.assertIn("function getInteractionBorderSnapshotState() {", owner_content)
        self.assertIn("function ensureInteractionBorderSnapshotCanvas() {", owner_content)
        self.assertIn("function invalidateInteractionBorderSnapshot(reason = \"unspecified\") {", owner_content)
        self.assertIn("function captureInteractionBorderSnapshot(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {", owner_content)
        self.assertIn("function drawInteractionBorderSnapshot(currentTransform = state.zoomTransform || globalThis.d3?.zoomIdentity) {", owner_content)


if __name__ == "__main__":
    unittest.main()
