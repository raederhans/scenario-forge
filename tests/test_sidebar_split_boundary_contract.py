from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
COUNTRY_INSPECTOR_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "country_inspector_controller.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
I18N_CATALOG_JS = REPO_ROOT / "js" / "core" / "i18n_catalog.js"


class SidebarSplitBoundaryContractTest(unittest.TestCase):
    def test_sidebar_imports_country_inspector_controller(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('./sidebar/country_inspector_controller.js', content)
        self.assertIn("createCountryInspectorController", content)
        owner_content = COUNTRY_INSPECTOR_CONTROLLER_JS.read_text(encoding="utf-8")
        self.assertIn('from "./country_inspector_model.js"', owner_content)
        self.assertNotIn('from "../sidebar.js"', owner_content)

    def test_country_inspector_owner_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = COUNTRY_INSPECTOR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createCountryInspectorController", owner_content)
        self.assertIn("const ensureSelectedInspectorCountry = () => {", owner_content)
        self.assertIn("const selectInspectorCountry = (code) => {", owner_content)
        self.assertIn("const renderCountrySelectRow = (", owner_content)
        self.assertIn("const renderCountryInspectorDetail = () => {", owner_content)
        self.assertIn("const renderList = ({ anchorGroupKey = \"\", previousHeaderTop = null } = {}) => {", owner_content)
        self.assertIn("const refreshCountryRows = ({", owner_content)
        self.assertIn("const closeCountryInspectorColorPicker = () => {", owner_content)
        self.assertIsNone(re.search(r"const\s+ensureSelectedInspectorCountry\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+selectInspectorCountry\s*=\s*\(code\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderCountrySelectRow\s*=\s*\(", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderCountryInspectorDetail\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderList\s*=\s*\(", sidebar_content))
        self.assertIsNone(re.search(r"const\s+refreshCountryRows\s*=\s*\(\{", sidebar_content))

    def test_sidebar_keeps_country_inspector_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("runtimeState: state,", content)
        self.assertIn("bindEvents: bindCountryInspectorEvents,", content)
        self.assertIn("closeCountryInspectorColorPicker,", content)
        self.assertIn("refreshCountryRows,", content)
        self.assertIn("renderCountryInspectorDetail,", content)
        self.assertIn("renderList,", content)
        self.assertIn('registerRuntimeHook(state, "renderCountryListFn", withEditorSelection(renderList));', content)
        self.assertIn('registerRuntimeHook(state, "refreshCountryListRowsFn", withEditorSelection(refreshCountryRows));', content)
        self.assertIn('registerRuntimeHook(state, "refreshCountryInspectorDetailFn", withEditorSelection(renderCountryInspectorDetail));', content)
        self.assertIn('const withEditorSelection = (callback) => (...args) => {', content)
        self.assertIn("bindCountryInspectorEvents();", content)

    def test_sidebar_collapse_labels_are_localized(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        catalog_content = I18N_CATALOG_JS.read_text(encoding="utf-8")

        for label in [
            "Collapse left sidebar",
            "Expand left sidebar",
            "Collapse right sidebar",
            "Expand right sidebar",
        ]:
            self.assertIn(label, sidebar_content)
            self.assertIn(label, catalog_content)

    def test_country_inspector_virtual_region_labels_and_scroll_anchor_are_wired(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = COUNTRY_INSPECTOR_CONTROLLER_JS.read_text(encoding="utf-8")
        catalog_content = I18N_CATALOG_JS.read_text(encoding="utf-8")

        for token in [
            '"China Region": {"zh": "中国区域", "en": "China Region"}',
            '"Russia Region": {"zh": "俄罗斯区域", "en": "Russia Region"}',
        ]:
            self.assertIn(token, catalog_content)

        for token in [
            "const keepGroupHeaderAtSameScrollPosition = (groupKey, previousHeaderTop = null) => {",
            "header.dataset.inspectorGroupKey = groupKey;",
            "const previousHeaderTop = header.getBoundingClientRect().top;",
            "renderList({ anchorGroupKey: groupKey, previousHeaderTop });",
        ]:
            self.assertIn(token, owner_content)

    def test_territories_presets_infers_country_from_selected_land(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        catalog_content = I18N_CATALOG_JS.read_text(encoding="utf-8")

        for token in [
            "getFeatureOwnerCode,",
            "const getSelectedLandFeatureIdsForCountryInference = () => {",
            "const inferCountryCodesFromSelectedLand = () => {",
            "const resolvePresetTreeCountryState = () => {",
            "const { countryState, reason } = resolvePresetTreeCountryState();",
            'reason: "multi-selection",',
            'createEmptyNote(t("Multiple countries are selected. Narrow the map selection to one country or choose a country in the inspector.", "ui"))',
        ]:
            self.assertIn(token, sidebar_content)

        self.assertIn(
            '"Multiple countries are selected. Narrow the map selection to one country or choose a country in the inspector.":',
            catalog_content,
        )

    def test_country_inspector_state_preserves_feature_count_fields(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")
        state_start = content.index("const createCountryInspectorState = (entry, fallbackIndex = 0) => {")
        state_return = content.index("return {", state_start)
        state_prefix = content[state_start:state_return]
        state_body = content[state_return:content.index("disabledRegionalPresetReason:", state_return)]

        self.assertIn("const ownerFeatureCount = Number(", state_prefix)
        self.assertIn("const controllerFeatureCount = Number(", state_prefix)
        self.assertIn("const featureCount = ownerFeatureCount;", state_prefix)
        self.assertIn("const normalizedEntryCode = normalizeCountryCode(", state_prefix)
        self.assertIn("const fallbackDisplayName = normalizeCountryDisplayNameCandidate(", state_prefix)
        self.assertIn("const displayName = t(displayNameSource, \"geo\") || displayNameSource || normalizedEntryCode;", state_prefix)
        self.assertIn("code: normalizedEntryCode || entry.code,", state_body)
        self.assertIn("name,", state_body)
        self.assertIn("displayName,", state_body)
        self.assertIn("featureCount,", state_body)
        self.assertIn("ownerFeatureCount,", state_body)
        self.assertIn("controllerFeatureCount,", state_body)

        self.assertIn("display_name_en: releasableEntry.display_name_en,", content)
        self.assertIn("display_name_zh: releasableEntry.display_name_zh,", content)
        self.assertIn("preset_source: releasableEntry.preset_source,", content)


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
