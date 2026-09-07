from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
ACTIONS_ROOT = REPO_ROOT / "js" / "core" / "state" / "actions"
RUNTIME_ACTIONS_JS = ACTIONS_ROOT / "scenario_chunk_runtime_actions.js"
ACTIVATION_ACTIONS_JS = ACTIONS_ROOT / "scenario_activation_actions.js"
PRESENTATION_ACTIONS_JS = ACTIONS_ROOT / "scenario_presentation_actions.js"
PROMOTION_ACTIONS_JS = ACTIONS_ROOT / "scenario_chunk_promotion_actions.js"
CHUNK_RUNTIME_JS = REPO_ROOT / "js" / "core" / "scenario" / "chunk_runtime.js"
CHUNK_PAYLOAD_LOADER_JS = REPO_ROOT / "js" / "core" / "scenario" / "chunk_payload_loader.js"
SCENARIO_LOCALIZATION_JS = REPO_ROOT / "js" / "core" / "scenario_localization_state.js"

RUNTIME_EXPORTS = (
    "ensureScenarioChunkRuntimeState",
    "resetScenarioChunkRuntimeState",
    "replaceScenarioChunkRuntimeState",
    "captureScenarioChunkLoadStateContinuation",
    "patchScenarioChunkLoadState",
    "commitScenarioChunkSelectionState",
    "beginScenarioChunkLoadState",
    "completeScenarioChunkLoadState",
    "failScenarioChunkLoadState",
    "finishScenarioChunkLoadState",
    "queueScenarioChunkPromotionState",
    "setScenarioChunkPromotionStatusState",
    "clearScenarioChunkPromotionState",
    "setScenarioChunkRuntimeHooksState",
    "commitScenarioChunkPayloadEntriesState",
    "evictScenarioChunkPayloadsState",
    "setScenarioChunkMergedLayerPayloadsState",
    "replaceScenarioChunkPendingPromotionIdentityState",
)

ACTIVATION_OPTIONAL_EXPORTS = (
    "getScenarioChunkOptionalLayerState",
    "applyScenarioChunkOptionalLayerState",
    "captureScenarioChunkPromotionState",
    "restoreScenarioChunkPromotionState",
)

PRESENTATION_CITY_EXPORTS = (
    "applyScenarioChunkCityExternalEffectState",
    "finalizeScenarioChunkCityExternalEffectState",
)

PROMOTION_EXPORTS = (
    "setScenarioPoliticalChunkPayloadState",
    "commitScenarioPoliticalChunkPayloadState",
    "bumpScenarioChunkDataGenerationState",
    "setScenarioChunkPromotionRenderLockState",
    "setDefaultRuntimePoliticalTopologyState",
    "captureScenarioChunkPromotionRootState",
    "restoreScenarioChunkPromotionRootState",
)

CHUNK_RUNTIME_DELEGATES = (
    "ensureScenarioChunkRuntimeState",
    "resetScenarioChunkRuntimeStateAction",
    "captureScenarioChunkLoadStateContinuation",
    "patchScenarioChunkLoadState",
    "commitScenarioChunkSelectionState",
    "beginScenarioChunkLoadState",
    "completeScenarioChunkLoadState",
    "failScenarioChunkLoadState",
    "finishScenarioChunkLoadState",
    "commitScenarioChunkPayloadEntriesState",
    "evictScenarioChunkPayloadsState",
    "setScenarioChunkMergedLayerPayloadsState",
    "replaceScenarioChunkPendingPromotionIdentityState",
    "queueScenarioChunkPromotionState",
    "setScenarioChunkPromotionStatusState",
    "clearScenarioChunkPromotionState",
    "applyScenarioChunkOptionalLayerState",
    "captureScenarioChunkPromotionState",
    "restoreScenarioChunkPromotionState",
    "finalizeScenarioChunkCityExternalEffectState",
    "captureScenarioChunkPromotionRootState",
    "restoreScenarioChunkPromotionRootState",
    "commitScenarioPoliticalChunkPayloadState",
    "bumpScenarioChunkDataGenerationState",
    "setScenarioChunkPromotionRenderLockState",
)


def read_required(path: Path, label: str) -> str:
    if not path.is_file():
        raise AssertionError(f"{label} must exist at {path.relative_to(REPO_ROOT)}")
    return path.read_text(encoding="utf-8")


class ScenarioChunkStateActionsBoundaryContractTest(unittest.TestCase):
    def test_action_modules_are_explicit_target_surfaces_with_only_canonical_factory_imports(self):
        modules = (
            (
                RUNTIME_ACTIONS_JS,
                "scenario chunk runtime actions",
                RUNTIME_EXPORTS,
                "SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS",
            ),
            (
                ACTIVATION_ACTIONS_JS,
                "scenario activation optional-layer actions",
                ACTIVATION_OPTIONAL_EXPORTS,
                "SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS",
            ),
            (
                PRESENTATION_ACTIONS_JS,
                "scenario presentation city actions",
                PRESENTATION_CITY_EXPORTS,
                None,
            ),
            (
                PROMOTION_ACTIONS_JS,
                "scenario chunk promotion actions",
                PROMOTION_EXPORTS,
                None,
            ),
        )
        for path, label, exports, frozen_catalog in modules:
            content = read_required(path, label)
            imports = re.findall(r'^\s*import\s+[\s\S]*?from\s+"([^"]+)";', content, re.MULTILINE)
            if path == RUNTIME_ACTIONS_JS:
                self.assertEqual(imports, ["../scenario_runtime_state.js"])
                self.assertIn("createDefaultActiveScenarioChunksState", content)
                self.assertIn("createDefaultRuntimeChunkLoadState", content)
            else:
                self.assertEqual(imports, [])
            if frozen_catalog:
                self.assertIn(f"export const {frozen_catalog} = Object.freeze(", content)
            for export_name in exports:
                self.assertRegex(
                    content,
                    rf"export function {re.escape(export_name)}\(\s*target(?:,|\))",
                )
            for forbidden in (
                "runtimeState",
                "document",
                "window",
                "globalThis",
                "Date.now",
                "callRuntimeHook",
                "recordRenderPerfMetric",
                "renderNow",
                "showToast",
            ):
                self.assertNotIn(forbidden, content, f"{label} leaked {forbidden}")

    def test_chunk_runtime_delegates_state_writes_to_both_action_modules(self):
        read_required(RUNTIME_ACTIONS_JS, "scenario chunk runtime actions")
        read_required(PROMOTION_ACTIONS_JS, "scenario chunk promotion actions")
        content = CHUNK_RUNTIME_JS.read_text(encoding="utf-8")

        self.assertIn(
            'from "../state/actions/scenario_chunk_runtime_actions.js";',
            content,
        )
        self.assertIn(
            'from "../state/actions/scenario_chunk_promotion_actions.js";',
            content,
        )
        self.assertIn(
            'from "../state/actions/scenario_activation_actions.js";',
            content,
        )
        self.assertIn(
            'from "../state/actions/scenario_presentation_actions.js";',
            content,
        )
        loader_content = read_required(CHUNK_PAYLOAD_LOADER_JS, "scenario chunk payload loader")
        self.assertIn('from "./chunk_payload_loader.js";', content)
        self.assertIn('from "../state/actions/scenario_chunk_runtime_actions.js";', loader_content)
        loader_actions = {
            "beginScenarioChunkLoadState", "completeScenarioChunkLoadState",
            "failScenarioChunkLoadState", "finishScenarioChunkLoadState",
        }
        for action_name in CHUNK_RUNTIME_DELEGATES:
            owner_content = loader_content if action_name in loader_actions else content
            self.assertRegex(owner_content, rf"\b{re.escape(action_name)}\(\s*runtimeState")

        direct_write_patterns = (
            r"\bruntimeState\.activeScenarioChunks\s*=(?!=)",
            r"\bruntimeState\.runtimeChunkLoadState\s*=(?!=)",
            r"\bruntimeState\.scenarioPoliticalChunkData\s*=(?!=)",
            r"\bruntimeState\.scenarioPoliticalVisibleChunkData\s*=(?!=)",
            r"\bruntimeState\.scenarioDataGenerationReason\s*=(?!=)",
            r"\bruntimeState\.scenarioChunkPromotionRenderLocked\s*=(?!=)",
            r"\bruntimeState\.scenarioWaterRegionsData\s*=(?!=)",
            r"\bruntimeState\.scenarioSpecialRegionsData\s*=(?!=)",
            r"\bruntimeState\.scenarioAtlantropaData\s*=(?!=)",
            r"\bruntimeState\.scenarioAtlantropaRevision\s*=(?!=)",
            r"\bruntimeState\.specialZoneLayers\s*=(?!=)",
            r"\bruntimeState\.scenarioReliefOverlaysData\s*=(?!=)",
            r"\bruntimeState\.scenarioReliefOverlayRevision\s*=(?!=)",
            r"\bruntimeState\.scenarioStrategicValuesData\s*=(?!=)",
            r"\bruntimeState\.scenarioStrategicValuesRevision\s*=(?!=)",
            r"\bruntimeState\.scenarioCityOverridesData\s*=(?!=)",
            r"\bruntimeState\.cityLayerRevision\s*=(?!=)",
            r"\bloadState\.pendingVisualPromotion\s*=(?!=)",
            r"\bloadState\.pendingInfraPromotion\s*=(?!=)",
            r"\bloadState\.pendingPromotion\s*=(?!=)",
            r"\bloadState\.promotionCommitStatus\s*=(?!=)",
            r"\bloadState\.lastSelection\s*=(?!=)",
            r"\bloadState\.selectionVersion\s*=(?!=)",
            r"\bloadState\.inFlightByChunkId\s*\[[^\]]+\]\s*=(?!=)",
            r"\bloadState\.errorByChunkId\s*\[[^\]]+\]\s*=(?!=)",
            r"\bchunkState\.payloadByChunkId\s*\[[^\]]+\]\s*=(?!=)",
            r"\bdelete\s+chunkState\.payloadByChunkId\s*\[[^\]]+\]",
            r"\bchunkState\.loadedChunkIds\s*=(?!=)",
            r"\bchunkState\.loadedChunkIds\.push\(",
            r"\bchunkState\.lruChunkIds\s*=(?!=)",
            r"\bchunkState\.lruChunkIds\.push\(",
            r"\bchunkState\.mergedLayerPayloads\s*=(?!=)",
            r"\b(?:pendingPromotion|resolvedPendingPromotion)\.scenarioApplyEpoch\s*=(?!=)",
            r"\b(?:pendingPromotion|resolvedPendingPromotion)\.scenarioApplyRequestId\s*=(?!=)",
            r"\bloadState\.zoomEndProtectedChunkIds\s*=(?!=)",
            r"\bloadState\.zoomEndProtectedUntil\s*=(?!=)",
            r"\bloadState\.zoomEndProtectedSelectionVersion\s*=(?!=)",
            r"\bloadState\.zoomEndProtectedScenarioId\s*=(?!=)",
            r"\bloadState\.zoomEndProtectedFocusCountry\s*=(?!=)",
        )
        content += "\n" + loader_content
        for pattern in direct_write_patterns:
            self.assertNotRegex(content, re.compile(pattern))

    def test_scenario_localization_delegates_city_external_effect_state(self):
        content = read_required(
            SCENARIO_LOCALIZATION_JS,
            "scenario localization state owner",
        )
        self.assertIn(
            'from "./state/actions/scenario_presentation_actions.js";',
            content,
        )
        self.assertRegex(
            content,
            r"\bapplyScenarioChunkCityExternalEffectState\(\s*runtimeState",
        )
        self.assertNotRegex(
            content,
            r"\bruntimeState\.scenarioCityOverridesData\s*=(?!=)",
        )
        self.assertNotRegex(
            content,
            r"\bruntimeState\.cityLayerRevision\s*=(?!=)",
        )


if __name__ == "__main__":
    unittest.main()
