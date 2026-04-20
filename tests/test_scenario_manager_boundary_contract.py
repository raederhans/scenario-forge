from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_APPLY_PIPELINE = REPO_ROOT / "js" / "core" / "scenario_apply_pipeline.js"
SCENARIO_LIFECYCLE_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "lifecycle_runtime.js"


class ScenarioManagerBoundaryContractTest(unittest.TestCase):
    def test_scenario_manager_no_longer_owns_panel_dom(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertNotIn('document.getElementById("scenario', content)
        self.assertIsNone(re.search(r"state\.updateScenarioUIFn\s*=(?!=)", content))
        self.assertNotIn("initScenarioManager", content)
        self.assertNotIn("function syncScenarioUi()", content)
        self.assertIsNone(re.search(r"^function\s+captureScenarioApplyRollbackSnapshot\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restoreScenarioApplyRollbackSnapshot\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+runPostRollbackRestoreEffects\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+ensureActiveScenarioOptionalLayerLoaded\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+ensureActiveScenarioOptionalLayersForVisibility\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+ensureScenarioGeoLocalePatchForLanguage\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+hydrateActiveScenarioBundle\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+loadScenarioAuditPayload\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+loadScenarioBundle\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+loadScenarioRegistry\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+releaseScenarioAuditPayload\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+validateImportedScenarioBaseline\b", content, re.MULTILINE))
        self.assertNotIn("SCENARIO_OPTIONAL_LAYER_CONFIGS", content)
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bensureActiveScenarioOptionalLayerLoaded\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bensureActiveScenarioOptionalLayersForVisibility\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bensureScenarioGeoLocalePatchForLanguage\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bhydrateActiveScenarioBundle\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bloadScenarioAuditPayload\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bloadScenarioBundle\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bloadScenarioRegistry\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\breleaseScenarioAuditPayload\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bvalidateImportedScenarioBaseline\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bapplyDefaultScenarioOnStartup\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bformatScenarioFatalRecoveryMessage\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bgetScenarioFatalRecoveryState\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\brefreshScenarioShellOverlays\b", content))

    def test_active_scenario_country_names_do_not_fall_back_to_global_map(self):
        content = SCENARIO_APPLY_PIPELINE.read_text(encoding="utf-8")

        self.assertIn('state.countryNames = staged.mapSemanticMode === "blank"', content)
        self.assertIn('? { ...countryNames }', content)
        self.assertIn(': { ...staged.scenarioNameMap };', content)
        self.assertNotIn(
            "state.countryNames = {\n      ...countryNames,\n      ...staged.scenarioNameMap,\n    };",
            content,
        )

    def test_scenario_manager_keeps_transaction_coordinator_role(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertIn('./scenario/presentation_runtime.js', content)
        self.assertIn('./scenario/lifecycle_runtime.js', content)
        self.assertIn("createScenarioPresentationRuntime({", content)
        self.assertIn("createScenarioLifecycleRuntime({", content)
        self.assertIn("applyScenarioBundle,", content)
        self.assertIn("applyScenarioById,", content)
        self.assertIn("resetToScenarioBaseline,", content)
        self.assertIn("clearActiveScenario,", content)
        self.assertIn("let activeScenarioApplyPromise = null;", content)
        self.assertIn("captureScenarioApplyRollbackSnapshot()", content)
        self.assertIn("restoreScenarioApplyRollbackSnapshot(rollbackSnapshot", content)
        self.assertIn("enterScenarioFatalRecovery({", content)
        self.assertIn('loadScenarioBundle(normalizedScenarioId, { bundleLevel: "full" })', content)
        self.assertIn("getScenarioDefaultCountryCode as getBundleLoaderDefaultCountryCode", content)

    def test_scenario_manager_delegates_presentation_runtime_owner(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r"^function\s+captureScenarioDisplaySettingsBeforeActivate\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+applyScenarioPerformanceHints\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restoreScenarioDisplaySettingsAfterExit\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+getScenarioOceanFillOverride\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+updateScenarioOceanFill\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+syncScenarioOceanFillForActivation\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restoreScenarioOceanFillAfterExit\b", content, re.MULTILINE))
        self.assertIn("const {", content)
        self.assertIn("applyScenarioPerformanceHints,", content)
        self.assertIn("restoreScenarioDisplaySettingsAfterExit,", content)
        self.assertIn("restoreScenarioOceanFillAfterExit,", content)
        self.assertIn("syncScenarioOceanFillForActivation,", content)

    def test_scenario_manager_delegates_lifecycle_runtime_owner(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r"^function\s+syncScenarioInspectorSelection\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+disableScenarioParentBorders\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restoreParentBordersAfterScenario\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+applyScenarioPaintMode\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+restorePaintModeAfterScenario\b", content, re.MULTILINE))
        self.assertIn("createScenarioLifecycleRuntime({", content)
        self.assertIn("clearActiveScenario: clearActiveScenarioRuntime,", content)
        self.assertIn("resetToScenarioBaseline: resetToScenarioBaselineRuntime,", content)
        self.assertIn("syncScenarioInspectorSelection,", content)
        self.assertIn("disableScenarioParentBorders,", content)
        self.assertIn("applyScenarioPaintMode,", content)
        self.assertIn("recalculateScenarioOwnerControllerDiffCount,", content)
        self.assertIn("resetToScenarioBaselineRuntime({", content)
        self.assertIn("clearActiveScenarioRuntime({", content)
        self.assertNotIn("if (changed) {\n    recalculateScenarioOwnerControllerDiffCount();\n  }", content)

    def test_scenario_manager_releases_state_apply_pipeline_owner(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertNotRegex(content, r"^async function prepareScenarioApplyState\b", re.MULTILINE)
        self.assertNotIn("state.scenarioRuntimeTopologyData = staged.runtimeTopologyPayload;", content)
        self.assertNotIn("state.scenarioBaselineOwnersByFeatureId = { ...staged.resolvedOwners };", content)
        self.assertNotIn('state.countryNames = staged.mapSemanticMode', content)
        self.assertNotIn('state.scheduleScenarioChunkRefreshFn = scenarioSupportsChunkedRuntime(bundle) ? scheduleScenarioChunkRefresh : null;', content)
        self.assertNotIn('cityOverridesPayload: staged.mapSemanticMode === "blank"', content)

    def test_apply_pipeline_owner_moves_to_new_module(self):
        content = SCENARIO_APPLY_PIPELINE.read_text(encoding="utf-8")
        lifecycle_content = SCENARIO_LIFECYCLE_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("prepareScenarioApplyState", content)
        self.assertIn("applyPreparedScenarioState", content)
        self.assertIn("state.scenarioRuntimeTopologyData =", content)
        self.assertIn("state.scenarioBaselineOwnersByFeatureId =", content)
        self.assertIn('state.countryNames = staged.mapSemanticMode', content)
        self.assertIn("state.scheduleScenarioChunkRefreshFn =", content)
        self.assertIn("syncScenarioLocalizationState({", content)
        self.assertIn("resetScenarioChunkRuntimeState(", content)
        self.assertNotIn("state.defaultRuntimePoliticalTopology =", content)
        self.assertNotIn('./scenario_manager.js', content)
        self.assertIn("syncScenarioInspectorSelection(state.activeSovereignCode);", content)
        self.assertIn("disableScenarioParentBorders();", content)
        self.assertIn("applyScenarioPaintMode();", content)
        self.assertNotIn('./scenario_apply_pipeline.js', lifecycle_content)


if __name__ == "__main__":
    unittest.main()
