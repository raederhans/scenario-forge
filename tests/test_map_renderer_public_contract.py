from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILE = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"
APP_UI_IMPORTERS = [
    REPO_ROOT / "js" / "main.js",
    REPO_ROOT / "js" / "bootstrap" / "deferred_detail_promotion.js",
    REPO_ROOT / "js" / "ui" / "toolbar.js",
    REPO_ROOT / "js" / "ui" / "shortcuts.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace" / "district_editor_controller.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace" / "scenario_tag_creator_controller.js",
    REPO_ROOT / "js" / "ui" / "dev_workspace" / "scenario_text_editors_controller.js",
    REPO_ROOT / "js" / "ui" / "sidebar.js",
]
INTERNAL_IMPORTERS = [
    REPO_ROOT / "js" / "core" / "logic.js",
    REPO_ROOT / "js" / "core" / "scenario_ownership_editor.js",
    REPO_ROOT / "js" / "core" / "scenario" / "scenario_renderer_bridge.js",
]
EXPECTED_PUBLIC_EXPORTS = {
    "RENDER_PASS_NAMES",
    "addFeatureToDevSelection",
    "applyDevMacroFillCurrentCountry",
    "applyDevMacroFillCurrentOwnerScope",
    "applyDevMacroFillCurrentParentGroup",
    "applyDevSelectionFill",
    "autoFillMap",
    "buildInteractionInfrastructureAfterStartup",
    "cancelActiveStrategicInteractionModes",
    "cancelOperationGraphicDraw",
    "cancelOperationalLineDraw",
    "cancelSpecialZoneDraw",
    "cancelUnitCounterPlacement",
    "clearDevSelection",
    "deleteSelectedManualSpecialZone",
    "deleteSelectedOperationGraphic",
    "deleteSelectedOperationGraphicVertex",
    "deleteSelectedOperationalLine",
    "deleteSelectedUnitCounter",
    "finishOperationGraphicDraw",
    "finishOperationalLineDraw",
    "finishSpecialZoneDraw",
    "getBathymetryPresetStyleDefaults",
    "getEffectiveCityCollection",
    "getWaterRegionColor",
    "getZoomPercent",
    "initMap",
    "invalidateContextLayerVisualStateBatch",
    "invalidateOceanBackgroundVisualState",
    "invalidateOceanCoastalAccentVisualState",
    "invalidateOceanVisualState",
    "invalidateOceanWaterInteractionVisualState",
    "rebuildStaticMeshes",
    "recomputeDynamicBordersNow",
    "refreshColorState",
    "refreshResolvedColorsForFeatures",
    "render",
    "renderExportPassesToCanvas",
    "renderLegend",
    "removeLastDevSelection",
    "resetZoomToFit",
    "scheduleDynamicBorderRecompute",
    "selectOperationGraphicById",
    "selectOperationalLineById",
    "selectSpecialZoneById",
    "selectUnitCounterById",
    "setDebugMode",
    "setMapData",
    "setZoomPercent",
    "startOperationGraphicDraw",
    "startOperationalLineDraw",
    "startSpecialZoneDraw",
    "startUnitCounterPlacement",
    "toggleFeatureInDevSelection",
    "undoOperationGraphicVertex",
    "undoOperationalLineVertex",
    "undoSpecialZoneVertex",
    "updateSelectedOperationGraphic",
    "updateSelectedOperationalLine",
    "updateSelectedUnitCounter",
    "zoomByStep",
}
IMPORT_BLOCK_RE = re.compile(
    r'import\s*\{(?P<names>[\s\S]*?)\}\s*from\s*[\"\'](?P<path>[^\"\']+)[\"\']',
    re.MULTILINE,
)
EXPORT_BLOCK_RE = re.compile(
    r'export\s*\{(?P<names>[\s\S]*?)\}\s*from\s*[\"\']\.\./map_renderer\.js[\"\'];',
    re.MULTILINE,
)


def parse_named_list(block: str) -> set[str]:
    result = set()
    normalized_block = re.sub(r"//.*", "", block)
    for raw_name in normalized_block.split(","):
        normalized = raw_name.strip()
        if not normalized:
            continue
        if normalized:
            result.add(normalized)
    return result


def get_imported_names(path: Path) -> set[str]:
    content = path.read_text(encoding="utf-8")
    names: set[str] = set()
    for match in IMPORT_BLOCK_RE.finditer(content):
        imported_path = match.group("path")
        if "map_renderer" not in imported_path:
            continue
        names.update(parse_named_list(match.group("names")))
    return names


class MapRendererPublicContractTest(unittest.TestCase):
    def test_public_whitelist_stays_explicit(self):
        content = PUBLIC_FILE.read_text(encoding="utf-8")
        match = EXPORT_BLOCK_RE.search(content)
        self.assertIsNotNone(match, "public.js must expose one explicit re-export block.")
        exported_names = parse_named_list(match.group("names"))
        self.assertEqual(EXPECTED_PUBLIC_EXPORTS, exported_names)

    def test_app_ui_importers_only_use_public_facade(self):
        for path in APP_UI_IMPORTERS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("map_renderer/public.js", content, path.name)
            self.assertNotIn("map_renderer.js", content.replace("map_renderer/public.js", ""), path.name)
            imported_names = get_imported_names(path)
            self.assertTrue(imported_names.issubset(EXPECTED_PUBLIC_EXPORTS), path.name)

    def test_internal_bridge_and_core_helpers_stay_on_internal_lane(self):
        for path in INTERNAL_IMPORTERS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("map_renderer.js", content, path.name)


if __name__ == "__main__":
    unittest.main()
