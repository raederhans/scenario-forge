from pathlib import Path
import json
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = REPO_ROOT / "package.json"
WORKFLOW_FILE = REPO_ROOT / ".github" / "workflows" / "perf-pr-gate.yml"
BASELINE_MD = REPO_ROOT / "docs" / "perf" / "baseline_2026-04-20.md"
BASELINE_JSON = REPO_ROOT / "docs" / "perf" / "baseline_2026-04-20.json"
PERF_SCRIPT = REPO_ROOT / "tools" / "perf" / "run_baseline.mjs"


class PerfGateContractTest(unittest.TestCase):
    def test_package_perf_gate_uses_real_gate_scenarios(self):
        package_payload = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        perf_gate_script = package_payload["scripts"]["perf:gate"]
        self.assertIn("--scenarios tno_1962,hoi4_1939", perf_gate_script)
        self.assertNotIn("blank_base", perf_gate_script)

    def test_workflow_matches_checked_in_baseline_environment(self):
        workflow_content = WORKFLOW_FILE.read_text(encoding="utf-8")
        baseline_payload = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
        baseline_os = str(baseline_payload["environment"]["os"])
        baseline_node = str(baseline_payload["environment"]["node"])
        self.assertTrue(baseline_os.startswith("win32 "), baseline_os)
        self.assertTrue(baseline_node.startswith("v22."), baseline_node)
        self.assertIn("runs-on: windows-latest", workflow_content)
        self.assertRegex(workflow_content, r'node-version:\s*[\"\']22[\"\']')
        self.assertIn("npx playwright install chromium", workflow_content)
        self.assertIn("npm run perf:gate", workflow_content)

    def test_baseline_markdown_declares_gate_vs_observation_roles(self):
        markdown = BASELINE_MD.read_text(encoding="utf-8")
        self.assertIn("- Gate scenarios: tno_1962, hoi4_1939", markdown)
        self.assertIn("- Observation samples: blank_base", markdown)
        self.assertRegex(markdown, r"## Scenario: blank_base\s+- sample_role: observation")
        self.assertRegex(markdown, r"## Scenario: tno_1962\s+- sample_role: gate")
        self.assertRegex(markdown, r"## Scenario: hoi4_1939\s+- sample_role: gate")

    def test_perf_script_locks_hardening_contract(self):
        script = PERF_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('const DEFAULT_GATE_SCENARIOS = ["tno_1962", "hoi4_1939"];', script)
        self.assertIn('if (activeScenarioId !== normalizeScenarioId(scenarioId)) {', script)
        self.assertIn('{ key: "scenarioAppliedMs", label: "scenarioAppliedMs" }', script)
        self.assertIn('{ key: "applyScenarioBundleMs", label: "applyScenarioBundleMs" }', script)
        self.assertIn('{ key: "refreshScenarioApplyMs", label: "refreshScenarioApplyMs" }', script)
        self.assertIn('{ key: "renderSampleMedianMs", label: "renderSampleMedianMs", threshold: 1.25 }', script)
        for field_name in (
            "scenarioFullHydrateMs",
            "interactionInfraMs",
            "scenarioChunkPromotionInfraStageMs",
            "startupBundleSource",
            "loadScenarioBundleMs",
            "drawContextScenarioPassMs",
            "setMapDataFirstPaintMs",
            "settleExactRefreshMs",
        ):
            self.assertIn(field_name, script)
        self.assertIn('bootMetrics["scenario-apply"]?.source', script)
        self.assertIn("Perf gate baseline contract mismatch.", script)


if __name__ == "__main__":
    unittest.main()
