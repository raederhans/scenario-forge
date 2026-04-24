from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
COUNTRY_INSPECTOR_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "country_inspector_controller.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"


class SidebarSplitBoundaryContractTest(unittest.TestCase):
    def test_sidebar_imports_country_inspector_controller(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('./sidebar/country_inspector_controller.js', content)
        self.assertIn("createCountryInspectorController", content)

    def test_country_inspector_owner_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = COUNTRY_INSPECTOR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createCountryInspectorController", owner_content)
        self.assertIn("const ensureSelectedInspectorCountry = () => {", owner_content)
        self.assertIn("const selectInspectorCountry = (code) => {", owner_content)
        self.assertIn("const renderCountrySelectRow = (", owner_content)
        self.assertIn("const renderCountryInspectorDetail = () => {", owner_content)
        self.assertIn("const renderList = () => {", owner_content)
        self.assertIn("const refreshCountryRows = ({", owner_content)
        self.assertIn("const closeCountryInspectorColorPicker = () => {", owner_content)
        self.assertIsNone(re.search(r"const\s+ensureSelectedInspectorCountry\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+selectInspectorCountry\s*=\s*\(code\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderCountrySelectRow\s*=\s*\(", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderCountryInspectorDetail\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderList\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+refreshCountryRows\s*=\s*\(\{", sidebar_content))

    def test_sidebar_keeps_country_inspector_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("runtimeState: state,", content)
        self.assertIn("bindEvents: bindCountryInspectorEvents,", content)
        self.assertIn("closeCountryInspectorColorPicker,", content)
        self.assertIn("refreshCountryRows,", content)
        self.assertIn("renderCountryInspectorDetail,", content)
        self.assertIn("renderList,", content)
        self.assertIn('registerRuntimeHook(state, "renderCountryListFn", renderList);', content)
        self.assertIn('registerRuntimeHook(state, "refreshCountryListRowsFn", refreshCountryRows);', content)
        self.assertIn('registerRuntimeHook(state, "refreshCountryInspectorDetailFn", renderCountryInspectorDetail);', content)
        self.assertIn("bindCountryInspectorEvents();", content)


    def test_auto_fill_refreshes_country_rows_before_full_list_fallback(self):
        content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        self.assertRegex(
            content,
            r'const changedCountryCodes = Object\.keys\(nextCountryBaseColors\);[\s\S]*?runtimeState\.refreshCountryListRowsFn\(\{[\s\S]*?countryCodes: changedCountryCodes,[\s\S]*?refreshPresetTree: true,[\s\S]*?\}\);[\s\S]*?else if \(typeof runtimeState\.renderCountryListFn === "function"\)',
        )

    def test_country_inspector_search_binding_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = COUNTRY_INSPECTOR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertNotIn('searchInput.addEventListener("input"', sidebar_content)
        self.assertIn('searchInput.addEventListener("input"', owner_content)

    def test_country_inspector_controller_keeps_exact_match_ranking_and_perf_counters(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = COUNTRY_INSPECTOR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("if (code === upperTerm) return 0;", owner_content)
        self.assertIn("if (displayName === term || name === term) return 1;", owner_content)
        self.assertIn('incrementSidebarCounter?.("fullListRenders");', owner_content)
        self.assertIn('incrementSidebarCounter?.("rowRefreshes", targetCodes.length || 1);', owner_content)
        self.assertIn('incrementSidebarCounter?.("inspectorRenders");', owner_content)
        self.assertIn("incrementSidebarCounter,", sidebar_content)


if __name__ == "__main__":
    unittest.main()
