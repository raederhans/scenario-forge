from pathlib import Path
import json
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
ATLANTROPA_DETAIL_CHUNK = REPO_ROOT / "data" / "scenarios" / "tno_1962" / "chunks" / "political.detail.country.atl.json"
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
WATER_SPECIAL_REGION_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "sidebar" / "water_special_region_controller.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
HISTORY_MANAGER_JS = REPO_ROOT / "js" / "core" / "history_manager.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"
INTERACTION_FUNNEL_UI_SYNC_JS = REPO_ROOT / "js" / "core" / "interaction_funnel" / "ui_sync.js"
CORE_I18N_JS = REPO_ROOT / "js" / "core" / "i18n.js"
UI_I18N_JS = REPO_ROOT / "js" / "ui" / "i18n.js"


def iter_features(value):
    if isinstance(value, dict):
        if value.get("type") == "Feature" and isinstance(value.get("properties"), dict):
            yield value
        for child in value.get("features", []):
            yield from iter_features(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_features(child)


class WaterSpecialRegionSidebarBoundaryContractTest(unittest.TestCase):
    def test_sidebar_imports_water_special_region_controller(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('import { createWaterSpecialRegionController } from "./sidebar/water_special_region_controller.js";', content)
        self.assertIn('createWaterSpecialRegionController', content)

    def test_water_and_special_owner_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('export function createWaterSpecialRegionController({', owner_content)
        self.assertIn('const renderWaterInteractionUi = () => {', owner_content)
        self.assertIn('const renderWaterRegionList = () => {', owner_content)
        self.assertIn('const renderSpecialRegionInspectorUi = () => {', owner_content)
        self.assertIn('const renderSpecialRegionList = () => {', owner_content)
        self.assertIn('const closeWaterInspectorColorPicker = () => {', owner_content)
        self.assertIn('const closeSpecialRegionColorPicker = () => {', owner_content)
        self.assertIsNone(re.search(r"const\s+renderWaterInteractionUi\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderWaterRegionList\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderSpecialRegionInspectorUi\s*=\s*\(\)\s*=>", sidebar_content))
        self.assertIsNone(re.search(r"const\s+renderSpecialRegionList\s*=\s*\(\)\s*=>", sidebar_content))

    def test_sidebar_keeps_water_and_special_facade_contract(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn('runtimeState: state,', content)
        self.assertIn('bindEvents: bindWaterSpecialRegionEvents,', content)
        self.assertIn('closeWaterInspectorColorPicker,', content)
        self.assertIn('closeSpecialRegionColorPicker,', content)
        self.assertIn('renderWaterInteractionUi,', content)
        self.assertIn('renderWaterRegionList,', content)
        self.assertIn('refreshWaterRegionRows,', content)
        self.assertIn('renderSpecialRegionInspectorUi,', content)
        self.assertIn('renderSpecialRegionList,', content)
        self.assertIn('refreshSpecialRegionRows,', content)
        self.assertIn('bindWaterSpecialRegionEvents();', content)
        self.assertIn('registerRuntimeHook(state, "renderWaterRegionListFn", renderWaterRegionList);', content)
        self.assertIn('registerRuntimeHook(state, "refreshWaterRegionListRowsFn", refreshWaterRegionRows);', content)
        self.assertIn('registerRuntimeHook(state, "updateWaterInteractionUIFn", renderWaterInteractionUi);', content)
        self.assertIn('registerRuntimeHook(state, "renderSpecialRegionListFn", renderSpecialRegionList);', content)
        self.assertIn('registerRuntimeHook(state, "refreshSpecialRegionListRowsFn", refreshSpecialRegionRows);', content)
        self.assertIn('registerRuntimeHook(state, "updateScenarioSpecialRegionUIFn", renderSpecialRegionInspectorUi);', content)
        self.assertIn('registerRuntimeHook(state, "updateScenarioReliefOverlayUIFn", renderSpecialRegionInspectorUi);', content)

    def test_water_search_binding_moves_to_controller(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertNotIn('waterSearchInput.addEventListener("input"', sidebar_content)
        self.assertIn('waterSearchInput.addEventListener("input"', owner_content)
        self.assertIn('specialRegionSearchInput.addEventListener("input"', owner_content)

    def test_controller_keeps_water_special_history_and_bridge_helpers(self):
        sidebar_content = SIDEBAR_JS.read_text(encoding="utf-8")
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('captureHistoryState({ waterRegionIds: nextIds })', owner_content)
        self.assertIn('updateSpecialZoneEditorUi();', owner_content)
        self.assertIn('updateWorkspaceStatus();', owner_content)
        self.assertIn('updateSpecialZoneEditorUi: () => callRuntimeHook(state, "updateSpecialZoneEditorUIFn"),', sidebar_content)
        self.assertIn('updateWorkspaceStatus: () => callRuntimeHook(state, "updateWorkspaceStatusFn"),', sidebar_content)

    def test_water_region_list_groups_fragment_rows_without_merging_geometry(self):
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("const WATER_FRAGMENT_SUFFIX_PATTERN = ", owner_content)
        self.assertIn("const getWaterFeatureAggregateKey = (feature) => {", owner_content)
        self.assertIn("const getWaterListDisplayItems = (features) => {", owner_content)
        self.assertIn("syncWaterAggregateMemberIndex(displayItems);", owner_content)
        self.assertIn('button.dataset.regionIds = memberIds.join("|");', owner_content)
        self.assertIn("waterRowRefsById.set(memberId, button);", owner_content)
        self.assertIn("candidateIds = getWaterAggregateMemberIds(normalizedSelectedId);", owner_content)
        self.assertIn(
            'applyWaterOverrideScope(selectedIds, nextColor, "inspector-water-region-color", "inspector-water-region-color");',
            owner_content,
        )
        self.assertNotIn("runtimeState.waterRegionOverrides[selectedId] = nextColor;", owner_content)

    def test_empty_water_override_list_hides_without_placeholder_space(self):
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('waterLegendList.classList.add("hidden");', owner_content)
        self.assertIn('waterLegendList.classList.remove("hidden");', owner_content)
        self.assertNotIn('createEmptyNote(t("Paint water regions to create an override list.", "ui"))', owner_content)

    def test_water_region_selection_handlers_request_map_render(self):
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")
        selection_patterns = [
            r"runtimeState\.selectedWaterRegionId = featureId;\s*"
            r"waterInspectorSection\?\.setAttribute\(\"open\", \"\"\);\s*"
            r"if \(typeof runtimeState\.renderWaterRegionListFn === \"function\"\) \{[\s\S]*?"
            r"if \(render\) render\(\);",
            r"runtimeState\.selectedWaterRegionId = childId;\s*"
            r"renderWaterRegionList\(\);\s*"
            r"if \(render\) render\(\);",
            r"runtimeState\.selectedWaterRegionId = featureId;\s*"
            r"waterInspectorSection\?\.setAttribute\(\"open\", \"\"\);\s*"
            r"renderWaterRegionList\(\);\s*"
            r"if \(render\) render\(\);",
            r"runtimeState\.selectedWaterRegionId = parentId;\s*"
            r"renderWaterRegionList\(\);\s*"
            r"if \(render\) render\(\);",
        ]

        for pattern in selection_patterns:
            self.assertRegex(owner_content, pattern)

    def test_hidden_water_toggles_clear_hover_and_selected_state(self):
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")
        clear_body = owner_content.split("const clearHiddenOpenOceanInteractionState = () => {", 1)[1].split(
            "\n  const formatWaterTokenLabel",
            1,
        )[0]
        toggle_handlers = owner_content.split("if (waterInspectorOpenOceanSelectToggle", 1)[1].split(
            "\n  if (waterInspectorChokepointToggle",
            1,
        )[0]

        self.assertIn("runtimeState.hoveredWaterRegionId = null;", clear_body)
        self.assertIn("runtimeState.selectedWaterRegionId = \"\";", clear_body)
        self.assertIn("!isWaterFeatureVisibleInInspector(hoveredFeature)", clear_body)
        self.assertIn("!isWaterFeatureVisibleInInspector(selectedFeature)", clear_body)
        self.assertEqual(toggle_handlers.count("clearHiddenOpenOceanInteractionState();"), 3)
        self.assertIn("waterInspectorLakeInteractionToggle.addEventListener", toggle_handlers)

    def test_atlantropa_water_fragments_keep_real_feature_ids(self):
        data = json.loads(ATLANTROPA_DETAIL_CHUNK.read_text(encoding="utf-8"))
        gabes_fragments = [
            feature
            for feature in iter_features(data)
            if feature["properties"].get("region_group") == "atlantropa_gulf_of_gabes_exposure_sea"
        ]

        self.assertGreaterEqual(len(gabes_fragments), 3)
        self.assertTrue(all(feature["properties"].get("id", "").startswith(("ATLSEA_", "ATLSEA_FILL_")) for feature in gabes_fragments))
        self.assertTrue(any(re.search(r"\d+-\d+-\d+$", feature["properties"].get("name", "")) for feature in gabes_fragments))
        self.assertTrue(any(re.search(r"Completion \d+$", feature["properties"].get("name", "")) for feature in gabes_fragments))

    def test_special_region_sidebar_is_read_only_after_override_retirement(self):
        owner_content = WATER_SPECIAL_REGION_CONTROLLER_JS.read_text(encoding="utf-8")
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        i18n_content = UI_I18N_JS.read_text(encoding="utf-8")

        self.assertNotIn("specialRegionLegendList", owner_content)
        self.assertNotIn("renderSpecialRegionLegend", owner_content)
        self.assertNotIn('createEmptyNote(t("Special region color overrides retired. Use Special Zones layers for editable narrative regions.", "ui"))', owner_content)
        self.assertIn("specialRegionColorInput.disabled = true;", owner_content)
        self.assertIn("clearSpecialRegionColorBtn.disabled = true;", owner_content)
        self.assertNotIn('["lblSpecialRegionLegend", "Special Region Reference"]', i18n_content)
        self.assertIn('["clearSpecialRegionColorBtn", "Special Region Overrides Retired"]', i18n_content)
        self.assertNotIn('["lblSpecialRegionLegend", "Special Region Overrides"]', i18n_content)
        self.assertNotIn('["clearSpecialRegionColorBtn", "Clear Special Region Override"]', i18n_content)
        self.assertNotIn("runtimeState.specialRegionOverrides[selectedId] = nextColor;", owner_content)
        self.assertNotIn("delete runtimeState.specialRegionOverrides[selectedId];", owner_content)
        self.assertNotIn("special-overrides:${stableJson(runtimeState.specialRegionOverrides || {})}", renderer_content)
        self.assertNotIn("getSafeCanvasColor(runtimeState.specialRegionOverrides?.[resolvedId], null);", renderer_content)
        self.assertNotIn("Object.prototype.hasOwnProperty.call(runtimeState.specialRegionOverrides || {}, resolvedId)", renderer_content)

    def test_renderer_history_and_import_funnel_keep_water_special_callbacks(self):
        map_renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        history_manager_content = HISTORY_MANAGER_JS.read_text(encoding="utf-8")
        interaction_funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        interaction_funnel_ui_sync_content = INTERACTION_FUNNEL_UI_SYNC_JS.read_text(encoding="utf-8")

        self.assertIn('runtimeState.renderWaterRegionListFn();', map_renderer_content)
        self.assertIn('runtimeState.renderSpecialRegionListFn();', map_renderer_content)
        self.assertIn('"renderWaterRegionListFn",', history_manager_content)
        self.assertIn('"renderSpecialRegionListFn",', history_manager_content)
        self.assertIn('syncProjectImportUiStateHelper', interaction_funnel_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.RENDER_WATER_REGION_LIST);', interaction_funnel_ui_sync_content)
        self.assertIn('emitStateBusEvent(STATE_BUS_EVENTS.RENDER_SPECIAL_REGION_LIST);', interaction_funnel_ui_sync_content)

    def test_water_and_special_tooltips_do_not_fabricate_country_codes_from_feature_ids(self):
        content = CORE_I18N_JS.read_text(encoding="utf-8")

        self.assertIn("function getTooltipFeatureCountryCode(feature, { useIdFallback = false } = {}) {", content)
        self.assertIn("return normalizeTooltipCountryCode(getSharedFeatureCountryCode(feature, { useIdFallback }));", content)
        self.assertIn("const code = getTooltipFeatureCountryCode(feature);", content)
        self.assertIn(
            'const countryCode = scenarioBaselineCode || getTooltipFeatureCountryCode(feature, { useIdFallback: true });',
            content,
        )


if __name__ == "__main__":
    unittest.main()
