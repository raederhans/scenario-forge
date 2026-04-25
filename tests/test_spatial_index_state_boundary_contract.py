from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SPATIAL_INDEX_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "spatial_index_state.js"
SPATIAL_INDEX_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_owner.js"
SPATIAL_INDEX_RUNTIME_STATE_OPS_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_state_ops.js"


class SpatialIndexStateBoundaryContractTest(unittest.TestCase):
    def test_spatial_index_state_owner_exports_shared_factories(self):
        owner_content = SPATIAL_INDEX_STATE_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultSecondarySpatialIndexState", owner_content)
        self.assertIn("createDefaultSpatialIndexState", owner_content)

    def test_spatial_index_runtime_owner_reuses_shared_factories(self):
        content = SPATIAL_INDEX_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        state_ops_content = SPATIAL_INDEX_RUNTIME_STATE_OPS_JS.read_text(encoding="utf-8")

        self.assertIn("./spatial_index_runtime_state_ops.js", content)
        self.assertIn("../state/spatial_index_state.js", state_ops_content)
        self.assertIn("createDefaultSecondarySpatialIndexState()", state_ops_content)
        self.assertIn("createDefaultSpatialIndexState()", state_ops_content)


if __name__ == "__main__":
    unittest.main()
