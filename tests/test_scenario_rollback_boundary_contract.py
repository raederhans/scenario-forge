from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ROLLBACK = REPO_ROOT / "js" / "core" / "scenario_rollback.js"


class ScenarioRollbackBoundaryContractTest(unittest.TestCase):
    def test_scenario_rollback_owns_snapshot_without_recovery_layer_dependency(self):
        content = SCENARIO_ROLLBACK.read_text(encoding="utf-8")

        self.assertIn("function captureScenarioRuntimeSnapshot()", content)
        self.assertIn("function captureScenarioPresentationSnapshot()", content)
        self.assertIn("function captureScenarioPaletteSnapshot()", content)
        self.assertIn("function restoreScenarioRuntimeSnapshot(snapshot)", content)
        self.assertIn("function restoreScenarioPresentationSnapshot(snapshot)", content)
        self.assertIn("function restoreScenarioPaletteSnapshot(snapshot)", content)
        self.assertIn("export function captureScenarioApplyRollbackSnapshot()", content)
        self.assertIn("export function restoreScenarioApplyRollbackSnapshot(", content)
        self.assertIn("const ROLLBACK_REQUIRED_KEYS = Object.freeze([", content)
        self.assertIn('"activeScenarioMeshPack"', content)
        self.assertIn('"scheduleScenarioChunkRefreshEnabled"', content)
        self.assertIn("activeScenarioMeshPack: cloneScenarioStateValue(runtimeState.activeScenarioMeshPack)", content)
        self.assertIn(
            'readRegisteredRuntimeHookSource(runtimeState, "scheduleScenarioChunkRefreshFn") === scheduleScenarioChunkRefresh',
            content,
        )
        self.assertIn("runtimeState.activeScenarioMeshPack = cloneScenarioStateValue(snapshot.activeScenarioMeshPack);", content)
        self.assertIn(
            "runtimeState.scheduleScenarioChunkRefreshFn = snapshot.scheduleScenarioChunkRefreshEnabled ? scheduleScenarioChunkRefresh : null;",
            content,
        )
        self.assertIn("Invalid rollback snapshot: missing required keys:", content)
        self.assertNotIn('from "./scenario_recovery.js"', content)
        self.assertNotIn("setMapData(", content)
        self.assertNotIn("rebuildPresetState(", content)
        self.assertNotIn("refreshScenarioShellOverlays(", content)
        self.assertNotIn("refreshScenarioOpeningOwnerBorders(", content)
        self.assertNotIn("refreshScenarioDataHealth(", content)
        self.assertNotIn("syncCountryUi(", content)

    def test_scenario_rollback_clears_chunk_promotion_runtime_handles(self):
        content = SCENARIO_ROLLBACK.read_text(encoding="utf-8")

        self.assertIn("refreshTimerId: null", content)
        self.assertIn("promotionTimerId: null", content)
        self.assertIn("promotionScheduled: false", content)
        self.assertIn("promotionCommitInFlight: false", content)
        self.assertIn('promotionCommitStatus: "rolled-back"', content)
        self.assertIn("pendingPostCommitRefresh: null", content)
        self.assertIn('callRuntimeHook(runtimeState, "cancelScenarioChunkPromotionCommitFn", "rolled-back");', content)
        self.assertNotIn("promotionCommitPromise", content)


if __name__ == "__main__":
    unittest.main()
