from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_RUNTIME_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "scenario_runtime_state.js"
CHUNK_RUNTIME_JS = REPO_ROOT / "js" / "core" / "scenario" / "chunk_runtime.js"
LIFECYCLE_RUNTIME_JS = REPO_ROOT / "js" / "core" / "scenario" / "lifecycle_runtime.js"
SCENARIO_ROLLBACK_JS = REPO_ROOT / "js" / "core" / "scenario_rollback.js"
SCENARIO_DATA_HEALTH_JS = REPO_ROOT / "js" / "core" / "scenario_data_health.js"


class ScenarioRuntimeStateBoundaryContractTest(unittest.TestCase):
    def test_scenario_runtime_state_owner_exports_runtime_factories(self):
        owner_content = SCENARIO_RUNTIME_STATE_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultActiveScenarioChunksState", owner_content)
        self.assertIn("createDefaultRuntimeChunkLoadState", owner_content)
        self.assertIn("createDefaultScenarioDataHealth", owner_content)
        self.assertIn("createDefaultScenarioHydrationHealthGate", owner_content)
        self.assertIn("createDefaultScenarioRuntimeState", owner_content)

    def test_scenario_runtime_consumers_reuse_owner_factories(self):
        chunk_content = CHUNK_RUNTIME_JS.read_text(encoding="utf-8")
        lifecycle_content = LIFECYCLE_RUNTIME_JS.read_text(encoding="utf-8")
        rollback_content = SCENARIO_ROLLBACK_JS.read_text(encoding="utf-8")
        health_content = SCENARIO_DATA_HEALTH_JS.read_text(encoding="utf-8")

        self.assertIn("../state/scenario_runtime_state.js", chunk_content)
        self.assertIn("createDefaultActiveScenarioChunksState()", chunk_content)
        self.assertIn("createDefaultRuntimeChunkLoadState({", chunk_content)
        self.assertIsNone(re.search(r"state\.runtimeChunkLoadState\s*=\s*\{\s*shellStatus:\s*\"idle\"", chunk_content))
        self.assertIn("../state/scenario_runtime_state.js", lifecycle_content)
        self.assertIn("createDefaultScenarioHydrationHealthGate()", lifecycle_content)
        self.assertIn("createDefaultScenarioDataHealth(", lifecycle_content)
        self.assertIn("./state/scenario_runtime_state.js", rollback_content)
        self.assertIn("createDefaultActiveScenarioChunksState()", rollback_content)
        self.assertIn("createDefaultScenarioHydrationHealthGate()", rollback_content)
        self.assertIn("createDefaultRuntimeChunkLoadState()", rollback_content)
        self.assertIn("./state/scenario_runtime_state.js", health_content)
        self.assertIn("createDefaultScenarioDataHealth(", health_content)


if __name__ == "__main__":
    unittest.main()
