from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"


class ScenarioManagerBoundaryContractTest(unittest.TestCase):
    def test_scenario_manager_no_longer_owns_panel_dom(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertNotIn('document.getElementById("scenario', content)
        self.assertIsNone(re.search(r"state\.updateScenarioUIFn\s*=(?!=)", content))
        self.assertNotIn("initScenarioManager", content)
        self.assertNotIn("recalculateScenarioOwnerControllerDiffCount,", content)
        self.assertNotIn("syncScenarioLocalizationState,", content)
        self.assertNotIn("function syncScenarioUi()", content)
        self.assertIsNone(re.search(r"^(async\s+)?function\s+ensureActiveScenarioOptionalLayerLoaded\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+ensureActiveScenarioOptionalLayersForVisibility\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+ensureScenarioGeoLocalePatchForLanguage\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+hydrateActiveScenarioBundle\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+loadScenarioAuditPayload\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+loadScenarioBundle\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+loadScenarioRegistry\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^function\s+releaseScenarioAuditPayload\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"^(async\s+)?function\s+validateImportedScenarioBaseline\b", content, re.MULTILINE))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bensureActiveScenarioOptionalLayerLoaded\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bensureActiveScenarioOptionalLayersForVisibility\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bensureScenarioGeoLocalePatchForLanguage\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bhydrateActiveScenarioBundle\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bloadScenarioAuditPayload\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bloadScenarioBundle\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bloadScenarioRegistry\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\breleaseScenarioAuditPayload\b", content))
        self.assertIsNone(re.search(r"export\s*\{[\s\S]*\bvalidateImportedScenarioBaseline\b", content))


if __name__ == "__main__":
    unittest.main()
