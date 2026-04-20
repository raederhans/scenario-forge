from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    REPO_ROOT / "tests" / "e2e" / "strategic_overlay_editing.spec.js",
    REPO_ROOT / "tests" / "e2e" / "strategic_overlay_frontline.spec.js",
    REPO_ROOT / "tests" / "e2e" / "strategic_overlay_roundtrip.spec.js",
]


class StrategicOverlayE2EReadyGateContractTest(unittest.TestCase):
    def test_strategic_overlay_specs_use_shared_playwright_app_helpers(self):
        for path in TARGETS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("./support/playwright-app", content, path.name)
            self.assertIn("waitForAppInteractive", content, path.name)
            self.assertIn("primeStateRef", content, path.name)

    def test_specs_drop_local_startup_ready_helpers(self):
        expectations = {
            "strategic_overlay_editing.spec.js": ["async function waitForAppReady(page)", "async function waitForScenarioUiReady(page)", "async function applyScenario(page, scenarioId)"],
            "strategic_overlay_frontline.spec.js": ["async function waitForProjectUiReady(page)", "async function applyScenario(page, scenarioId)"],
            "strategic_overlay_roundtrip.spec.js": ["async function waitForAppReady(page)"],
        }
        for file_name, forbidden_snippets in expectations.items():
            content = (REPO_ROOT / "tests" / "e2e" / file_name).read_text(encoding="utf-8")
            for forbidden in forbidden_snippets:
                self.assertNotIn(forbidden, content, file_name)


if __name__ == "__main__":
    unittest.main()
