from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
STARTUP_BOOT_OVERLAY_JS = REPO_ROOT / "js" / "bootstrap" / "startup_boot_overlay.js"


class MainBootOverlaySplitBoundaryContractTest(unittest.TestCase):
    def test_main_imports_startup_boot_overlay(self):
        content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn('./bootstrap/startup_boot_overlay.js', content.replace('"', "'"))
        self.assertIn("createStartupBootOverlayController", content)

    def test_startup_boot_overlay_owns_boot_overlay_and_metrics_shell(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")
        owner_content = STARTUP_BOOT_OVERLAY_JS.read_text(encoding="utf-8")

        self.assertIn("const BOOT_PHASE_WINDOWS = {", owner_content)
        self.assertIn("const BOOT_COPY = {", owner_content)
        self.assertIn("const STARTUP_READONLY_COPY = {", owner_content)
        self.assertIn("export function createStartupBootOverlayController()", owner_content)
        self.assertIn("const syncBootOverlay = () => {", owner_content)
        self.assertIn("const setBootState = (", owner_content)
        self.assertIn("const resetBootMetrics = () => {", owner_content)
        self.assertIn("const completeBootSequenceLogging = () => {", owner_content)

        self.assertIsNone(re.search(r"function\s+syncBootOverlay\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+setBootState\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+resetBootMetrics\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+completeBootSequenceLogging\s*\(", donor_content))

    def test_main_keeps_bootstrap_facade_and_controller_wiring(self):
        content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("const bootOverlayController = createStartupBootOverlayController();", content)
        self.assertIn('registerRuntimeHook(state, "setStartupReadonlyStateFn", setStartupReadonlyState);', content)
        self.assertIn("function requestMainRender(reason = \"\", { flush = false } = {}) {", content)
        self.assertIn("async function bootstrap()", content)
        self.assertIn("bootstrap();", content)

    def test_overlay_controller_keeps_dom_and_readonly_contracts(self):
        owner_content = STARTUP_BOOT_OVERLAY_JS.read_text(encoding="utf-8")

        self.assertIn('document.getElementById("bootOverlay")', owner_content)
        self.assertIn('document.getElementById("startupReadonlyBanner")', owner_content)
        self.assertIn("dom.readonlyMessage.textContent = getStartupReadonlyMessage();", owner_content)
        self.assertIn("state.bootPreviewVisible = !!active;", owner_content)
        self.assertIn("state.startupReadonly = !!active;", owner_content)
        self.assertIn("scheduleStartupReadonlyUnlockTimer", owner_content)


if __name__ == "__main__":
    unittest.main()
