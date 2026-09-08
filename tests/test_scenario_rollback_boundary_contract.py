from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ROLLBACK = REPO_ROOT / "js" / "core" / "scenario_rollback.js"
SCENARIO_TRANSACTION_ROLLBACK_ACTIONS = (
    REPO_ROOT
    / "js"
    / "core"
    / "state"
    / "actions"
    / "scenario_transaction_rollback_actions.js"
)
SCENARIO_ACTIVATION_ACTIONS = (
    REPO_ROOT / "js" / "core" / "state" / "actions" / "scenario_activation_actions.js"
)
SCENARIO_PRESENTATION_ACTIONS = (
    REPO_ROOT / "js" / "core" / "state" / "actions" / "scenario_presentation_actions.js"
)


class ScenarioRollbackBoundaryContractTest(unittest.TestCase):
    def test_scenario_rollback_owns_snapshot_without_recovery_layer_dependency(self):
        content = SCENARIO_ROLLBACK.read_text(encoding="utf-8")
        action_content = SCENARIO_TRANSACTION_ROLLBACK_ACTIONS.read_text(
            encoding="utf-8"
        )
        activation_content = SCENARIO_ACTIVATION_ACTIONS.read_text(encoding="utf-8")
        presentation_content = SCENARIO_PRESENTATION_ACTIONS.read_text(
            encoding="utf-8"
        )
        health_content = (
            REPO_ROOT
            / "js"
            / "core"
            / "state"
            / "actions"
            / "scenario_health_actions.js"
        ).read_text(encoding="utf-8")

        self.assertIn("function captureScenarioRuntimeSnapshot(cloneValue)", content)
        self.assertIn("function captureScenarioPresentationSnapshot(cloneValue)", content)
        self.assertIn("function captureScenarioPaletteSnapshot(cloneValue)", content)
        self.assertIn(
            "function buildScenarioTransactionRollbackStatePatch(snapshot)",
            content,
        )
        self.assertIn(
            'from "./state/actions/scenario_transaction_rollback_actions.js"',
            content,
        )
        self.assertIn(
            "validateScenarioTransactionRollbackSupplementalStatePatch(",
            content,
        )
        for capture_name in (
            "captureScenarioActivationState",
            "captureScenarioPresentationState",
            "captureScenarioPaletteState",
            "captureScenarioTransactionRollbackOptionalState",
            "captureScenarioTransactionRollbackSupplementalState",
        ):
            self.assertIn(f"{capture_name}(", content)
        self.assertIn(
            "export function captureScenarioTransactionRollbackSupplementalState(",
            action_content,
        )
        for export_name in (
            "restoreScenarioActivationBeforeAuditState",
            "restoreScenarioActivationBeforeColorDirtyState",
            "restoreScenarioActivationAfterColorDirtyState",
        ):
            self.assertIn(f"export function {export_name}(", activation_content)
        self.assertIn(
            "export function restoreScenarioTransactionPresentationBeforeAuditState(",
            presentation_content,
        )
        self.assertIn(
            "export function restoreScenarioTransactionPresentationState(",
            presentation_content,
        )
        for export_name in (
            "restoreScenarioHydrationHealthGateState",
            "restoreScenarioDataHealthState",
        ):
            self.assertIn(f"export function {export_name}(", health_content)
        self.assertIn(
            "export function setActiveScenarioPerformanceHintsState(",
            presentation_content,
        )
        self.assertIn("export function captureScenarioApplyRollbackSnapshot()", content)
        self.assertIn("export function restoreScenarioApplyRollbackSnapshot(", content)
        self.assertIn("const ROLLBACK_REQUIRED_KEYS = Object.freeze([", content)
        self.assertIn('"activeScenarioMeshPack"', content)
        self.assertIn('"scheduleScenarioChunkRefreshEnabled"', content)
        self.assertIn('"awaitInitialScenarioChunkVisualPromotionEnabled"', content)
        self.assertIn('"scenarioPoliticalVisibleChunkData"', content)
        self.assertIn('"legendLabels"', content)
        self.assertIn('"legendConfig"', content)
        self.assertIn(
            "readHookSource: readRegisteredRuntimeHookSource",
            content,
        )
        self.assertIn(
            "scheduleScenarioChunkRefreshSource:",
            content,
        )
        self.assertIn(
            "awaitInitialScenarioChunkVisualPromotionSource:",
            content,
        )
        self.assertNotIn(
            "cloneScenarioStateValue(runtimeState.activeScenarioMeshPack)",
            content,
        )
        self.assertNotIn(
            "cloneScenarioStateValue(runtimeState.scenarioPoliticalVisibleChunkData)",
            content,
        )
        self.assertNotIn(
            "cloneScenarioStateValue(runtimeState.legendLabels)",
            content,
        )
        self.assertNotIn(
            "cloneScenarioStateValue(runtimeState.legendConfig)",
            content,
        )
        self.assertNotIn("target.activeScenarioMeshPack =", action_content)
        self.assertIn("target.activeScenarioMeshPack =", activation_content)
        self.assertIn(
            "setScenarioPoliticalChunkPayloadState(runtimeState, {",
            content,
        )
        self.assertNotIn("setScenarioPoliticalChunkPayloadState(target, {", action_content)
        self.assertNotIn("target.scenarioPoliticalVisibleChunkData =", action_content)
        self.assertNotIn("target.legendLabels =", action_content)
        self.assertNotIn("target.legendConfig =", action_content)
        self.assertIn(
            "scheduleScenarioChunkRefreshFn:",
            content,
        )
        self.assertIn(
            "awaitInitialScenarioChunkVisualPromotionFn:",
            content,
        )
        self.assertIn("setScenarioChunkRuntimeHooksState(runtimeState, {", content)
        self.assertIn("replaceScenarioChunkRuntimeState(runtimeState, {", content)
        self.assertNotIn("setScenarioChunkRuntimeHooksState(target, {", action_content)
        self.assertNotIn("replaceScenarioChunkRuntimeState(target, {", action_content)
        self.assertNotIn("target.scheduleScenarioChunkRefreshFn =", action_content)
        self.assertNotIn("target.awaitInitialScenarioChunkVisualPromotionFn =", action_content)
        self.assertNotIn("target.activeScenarioChunks =", action_content)
        self.assertNotIn("target.runtimeChunkLoadState =", action_content)
        self.assertNotIn("runtimeState.activeScenarioMeshPack =", content)
        self.assertNotIn("runtimeState.scenarioPoliticalVisibleChunkData =", content)
        self.assertNotIn("runtimeState.legendLabels =", content)
        self.assertNotIn("runtimeState.legendConfig =", content)
        self.assertIn("Invalid rollback snapshot: missing required keys:", content)
        self.assertIn("function markScenarioRollbackSceneSnapshotRestored(previousScenarioId = \"\")", content)
        self.assertIn('bumpSceneGenerationState(runtimeState, "scenario-rollback");', content)
        self.assertIn('bumpScenarioDataGenerationState(runtimeState, "scenario-rollback");', content)
        self.assertNotIn('from "./scenario_recovery.js"', content)
        self.assertNotIn("setMapData(", content)
        self.assertNotIn("rebuildPresetState(", content)
        self.assertNotIn("refreshScenarioShellOverlays(", content)
        self.assertNotIn("refreshScenarioOpeningOwnerBorders(", content)
        self.assertNotIn("refreshScenarioDataHealth(", content)
        self.assertNotIn("syncCountryUi(", content)
        effect_order = [
            'callRuntimeHook(runtimeState, "cancelScenarioChunkPromotionCommitFn", "rolled-back");',
            "restoreScenarioActivationBeforeAuditState(",
            "setDefaultRuntimePoliticalTopologyState(",
            "restoreScenarioHydrationHealthGateState(",
            "restoreScenarioTransactionPresentationBeforeAuditState(",
            "setScenarioAuditUiState(",
            "restoreScenarioActivationBeforeColorDirtyState(",
            "restoreScenarioReadinessState(",
            "restoreScenarioDataHealthState(",
            "markLegacyColorStateDirty();",
            "restoreScenarioActivationAfterColorDirtyState(",
            "setActiveScenarioPerformanceHintsState(",
            "setScenarioPoliticalChunkPayloadState(",
            "replaceScenarioChunkRuntimeState(",
            "setScenarioChunkRuntimeHooksState(",
            "restoreScenarioTransactionPresentationState(",
            "restoreScenarioPaletteState(",
            "syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });",
            "markScenarioRollbackSceneSnapshotRestored(previousScenarioId);",
        ]
        positions = [content.index(token) for token in effect_order]
        self.assertEqual(
            positions,
            sorted(positions),
            "rollback hooks and effects must retain their canonical order",
        )

    def test_scenario_rollback_clears_chunk_promotion_runtime_handles(self):
        content = SCENARIO_ROLLBACK.read_text(encoding="utf-8")
        action_content = SCENARIO_TRANSACTION_ROLLBACK_ACTIONS.read_text(
            encoding="utf-8"
        )

        self.assertIn("refreshTimerId: null", action_content)
        self.assertIn("promotionTimerId: null", action_content)
        self.assertIn("promotionScheduled: false", action_content)
        self.assertIn("promotionCommitInFlight: false", action_content)
        self.assertIn('promotionCommitStatus: "rolled-back"', action_content)
        self.assertIn("pendingPostCommitRefresh: null", action_content)
        self.assertIn('callRuntimeHook(runtimeState, "cancelScenarioChunkPromotionCommitFn", "rolled-back");', content)
        self.assertNotIn("promotionCommitPromise", content)


if __name__ == "__main__":
    unittest.main()
