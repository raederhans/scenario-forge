from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
HEALTH_ACTIONS = (
    REPO_ROOT / "js" / "core" / "state" / "actions" / "scenario_health_actions.js"
)
PRESENTATION_ACTIONS = (
    REPO_ROOT
    / "js"
    / "core"
    / "state"
    / "actions"
    / "scenario_presentation_actions.js"
)
RUNTIME_STATE = REPO_ROOT / "js" / "core" / "state" / "scenario_runtime_state.js"
STARTUP_HYDRATION = REPO_ROOT / "js" / "core" / "scenario" / "startup_hydration.js"
DATA_HEALTH = REPO_ROOT / "js" / "core" / "scenario_data_health.js"
DISPLAY_RESTORE = (
    REPO_ROOT / "js" / "core" / "scenario" / "presentation_display_restore.js"
)
LIFECYCLE = REPO_ROOT / "js" / "core" / "scenario" / "lifecycle_runtime.js"
ROLLBACK = REPO_ROOT / "js" / "core" / "scenario_rollback.js"
TRANSACTION_ROLLBACK_ACTIONS = (
    REPO_ROOT
    / "js"
    / "core"
    / "state"
    / "actions"
    / "scenario_transaction_rollback_actions.js"
)


class ScenarioHealthActionsBoundaryContractTest(unittest.TestCase):
    def test_health_and_hint_writes_use_canonical_actions(self):
        health_actions = HEALTH_ACTIONS.read_text(encoding="utf-8")
        presentation_actions = PRESENTATION_ACTIONS.read_text(encoding="utf-8")
        runtime_state = RUNTIME_STATE.read_text(encoding="utf-8")
        startup = STARTUP_HYDRATION.read_text(encoding="utf-8")
        data_health = DATA_HEALTH.read_text(encoding="utf-8")
        display = DISPLAY_RESTORE.read_text(encoding="utf-8")
        lifecycle = LIFECYCLE.read_text(encoding="utf-8")
        rollback = ROLLBACK.read_text(encoding="utf-8")
        supplemental = TRANSACTION_ROLLBACK_ACTIONS.read_text(encoding="utf-8")

        self.assertIn("export function setScenarioHydrationHealthGateState(", health_actions)
        self.assertIn("export function captureScenarioHealthState(", health_actions)
        self.assertIn("export function restoreScenarioHydrationHealthGateState(", health_actions)
        self.assertIn("export function setScenarioDataHealthState(", health_actions)
        self.assertIn("export function restoreScenarioDataHealthState(", health_actions)
        self.assertIn("export function setActiveScenarioPerformanceHintsState(", presentation_actions)
        self.assertIn("export function captureActiveScenarioPerformanceHintsState(", presentation_actions)
        self.assertNotIn("\nimport ", health_actions)

        self.assertIn("export function normalizeScenarioDataHealthState(", runtime_state)
        self.assertIn("export function normalizeScenarioHydrationHealthGateState(", runtime_state)
        self.assertNotIn("target.scenarioDataHealth =", runtime_state)
        self.assertNotIn("target.scenarioHydrationHealthGate =", runtime_state)

        self.assertIn('from "../state/actions/scenario_health_actions.js"', startup)
        self.assertIn('from "./state/actions/scenario_health_actions.js"', data_health)
        self.assertIn("setActiveScenarioPerformanceHintsState(state, hints);", display)
        self.assertIn("setActiveScenarioPerformanceHintsState(state, null);", display)
        self.assertIn("restoreScenarioHydrationHealthGateState(", lifecycle)
        self.assertIn("restoreScenarioDataHealthState(", lifecycle)
        self.assertIn("captureScenarioHealthState(runtimeState)", rollback)
        self.assertIn("captureActiveScenarioPerformanceHintsState(runtimeState)", rollback)
        self.assertNotIn("cloneScenarioStateValue(\n      runtimeState.scenarioHydrationHealthGate", rollback)
        self.assertNotIn("cloneScenarioStateValue(\n      runtimeState.scenarioDataHealth", rollback)
        self.assertNotIn("cloneScenarioStateValue(\n      runtimeState.activeScenarioPerformanceHints", rollback)

        self.assertNotIn("target.scenarioHydrationHealthGate =", supplemental)
        self.assertNotIn("target.scenarioDataHealth =", supplemental)
        self.assertNotIn("target.activeScenarioPerformanceHints =", supplemental)
        self.assertNotIn("restoreScenarioTransactionSupplementBeforeAuditState", supplemental)
        self.assertNotIn("restoreScenarioTransactionSupplementBeforeColorDirtyState", supplemental)
        self.assertNotIn("restoreScenarioTransactionSupplementAfterColorDirtyState", supplemental)

        order = [
            "restoreScenarioHydrationHealthGateState(",
            "setScenarioAuditUiState(",
            "restoreScenarioDataHealthState(",
            "setActiveScenarioPerformanceHintsState(",
            "replaceScenarioChunkRuntimeState(",
        ]
        positions = [rollback.index(token) for token in order]
        self.assertEqual(positions, sorted(positions))

        health_gate = startup[startup.index(
            "async function enforceScenarioHydrationHealthGate("
        ):startup.index("\n  return {", startup.index(
            "async function enforceScenarioHydrationHealthGate("
        ))]
        retry = health_gate[health_gate.index("if (autoRetry) {"):]
        retry_order = [
            "forceReload: true",
            "hydrateActiveScenarioBundle(refreshedBundle, { renderNow: false });",
            "evaluateScenarioHydrationHealthGateState({",
            'flushRenderBoundary("scenario-health-gate-retry-recovered")',
            "clearScenarioHealthGateReadonlyState();",
            "setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({",
            "syncScenarioUi();",
        ]
        retry_positions = [retry.index(token) for token in retry_order]
        self.assertEqual(retry_positions, sorted(retry_positions))

        fallback_start = health_gate.index(
            "const hadScenarioOverlay = resetScenarioHydrationOverlayState(state);"
        )
        fallback = health_gate[fallback_start:]
        fallback_order = [
            "showToast(",
            "setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({",
            "syncScenarioUi();",
            'flushRenderBoundary("scenario-health-gate-fallback")',
        ]
        fallback_positions = [fallback.index(token) for token in fallback_order]
        self.assertEqual(fallback_positions, sorted(fallback_positions))

        health_publish = data_health[data_health.index("const health = evaluateScenarioDataHealth("):]
        publish_order = [
            "setScenarioDataHealthState(",
            "normalizeScenarioDataHealthState(health, minRatio)",
            "showToast(health.warning, {",
        ]
        publish_positions = [health_publish.index(token) for token in publish_order]
        self.assertEqual(publish_positions, sorted(publish_positions))
        self.assertLess(
            display.index("setActiveScenarioPerformanceHintsState(state, hints);"),
            display.index("syncScenarioPresentationUi();", display.index(
                "function applyScenarioPerformanceHints(manifest)"
            )),
        )
        self.assertLess(
            display.index("setActiveScenarioPerformanceHintsState(state, null);"),
            display.index("syncScenarioPresentationUi();", display.index(
                "function restoreScenarioDisplaySettingsAfterExit()"
            )),
        )
        lifecycle_order = [
            "restoreScenarioHydrationHealthGateState(",
            "restoreScenarioDataHealthState(",
            "restoreScenarioDisplaySettingsAfterExit();",
            "runPostScenarioClearEffects({ renderNow });",
        ]
        lifecycle_positions = [lifecycle.index(token) for token in lifecycle_order]
        self.assertEqual(lifecycle_positions, sorted(lifecycle_positions))


if __name__ == "__main__":
    unittest.main()
