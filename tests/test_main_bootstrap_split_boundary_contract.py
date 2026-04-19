from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
STARTUP_BOOTSTRAP_SUPPORT_JS = REPO_ROOT / "js" / "bootstrap" / "startup_bootstrap_support.js"


class MainBootstrapSplitBoundaryContractTest(unittest.TestCase):
    def test_main_imports_startup_bootstrap_support(self):
        content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn('./bootstrap/startup_bootstrap_support.js', content.replace('"', "'"))
        self.assertIn('./bootstrap/startup_boot_overlay.js', content.replace('"', "'"))
        self.assertIn("createStartupBundleLoadDiagnostics", content)
        self.assertIn("getConfiguredDefaultScenarioId", content)
        self.assertIn("warnOnStartupBundleIntegrity", content)

    def test_startup_bootstrap_support_owns_startup_helpers(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")
        owner_content = STARTUP_BOOTSTRAP_SUPPORT_JS.read_text(encoding="utf-8")

        self.assertIn("export function processHierarchyData(data)", owner_content)
        self.assertIn("export function hydrateLanguage()", owner_content)
        self.assertIn("export function createRenderDispatcher(renderFn)", owner_content)
        self.assertIn("export function getConfiguredDefaultScenarioId()", owner_content)
        self.assertIn("export function createStartupBundleLoadDiagnostics({", owner_content)
        self.assertIn("export function createStartupBootArtifactsOverride({", owner_content)
        self.assertIn("export async function postStartupSupportKeyUsageReport({ scenarioId = \"\", source = \"\" } = {})", owner_content)

        self.assertIsNone(re.search(r"function\s+processHierarchyData\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+hydrateLanguage\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+createRenderDispatcher\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+getConfiguredDefaultScenarioId\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+createStartupBundleLoadDiagnostics\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+createStartupBootArtifactsOverride\s*\(", donor_content))

    def test_main_keeps_bootstrap_entry_and_overlay_facade(self):
        content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("function requestMainRender(reason = \"\", { flush = false } = {}) {", content)
        self.assertIn("const bootOverlayController = createStartupBootOverlayController();", content)
        self.assertIn("async function bootstrap()", content)
        self.assertIn("bootstrap();", content)

    def test_startup_bootstrap_support_keeps_runtime_contracts(self):
        owner_content = STARTUP_BOOTSTRAP_SUPPORT_JS.read_text(encoding="utf-8")

        self.assertIn('const STARTUP_SUPPORT_AUDIT_REPORT_URL = "/__dev/startup-support/key-usage-report";', owner_content)
        self.assertIn("consumeStartupSupportKeyUsageAuditReport()", owner_content)
        self.assertIn("state.countryInteractionPoliciesByCode.set(code, {", owner_content)
        self.assertIn("state.styleConfig.cityPoints = normalizeCityLayerStyleConfig({", owner_content)
        self.assertIn("const hasScenarioRuntimeBootstrap = hasScenarioRuntimeShellContract({", owner_content)


if __name__ == "__main__":
    unittest.main()
