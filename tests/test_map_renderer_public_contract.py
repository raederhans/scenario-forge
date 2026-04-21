from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
JS_ROOT = REPO_ROOT / "js"
CORE_ROOT = JS_ROOT / "core"
MAP_RENDERER_ENTRY = CORE_ROOT / "map_renderer.js"
MAP_RENDERER_DIR = CORE_ROOT / "map_renderer"
PUBLIC_FILE = MAP_RENDERER_DIR / "public.js"
ALLOWED_INTERNAL_ENTRY_IMPORTERS = {
    PUBLIC_FILE,
    CORE_ROOT / "logic.js",
    CORE_ROOT / "scenario_ownership_editor.js",
    CORE_ROOT / "scenario" / "scenario_renderer_bridge.js",
}
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
IMPORT_SPEC_RE = re.compile(
    r"""
    (?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](?P<static_path>[^"']+)["']
    |
    import\s*\(\s*["'](?P<dynamic_path>[^"']+)["']\s*\)
    """,
    re.MULTILINE | re.VERBOSE,
)
NAMED_IMPORT_RE = re.compile(
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
        if normalized:
            result.add(normalized)
    return result


def relative_path(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def resolve_import_target(importer: Path, import_path: str) -> Path | None:
    normalized = str(import_path or "").strip()
    if not normalized or normalized.startswith(("node:", "http://", "https://")):
        return None
    if normalized.startswith("/"):
        target = REPO_ROOT / normalized.lstrip("/")
    else:
        target = importer.parent / normalized
    return target.resolve()


def iter_js_files() -> list[Path]:
    return sorted(path.resolve() for path in JS_ROOT.rglob("*.js") if path.is_file())


def get_import_targets(path: Path) -> list[tuple[str, Path]]:
    content = path.read_text(encoding="utf-8")
    targets: list[tuple[str, Path]] = []
    for match in IMPORT_SPEC_RE.finditer(content):
        import_path = match.group("static_path") or match.group("dynamic_path")
        target = resolve_import_target(path, import_path)
        if target is not None:
            targets.append((str(import_path), target))
    return targets


def get_public_named_imports(path: Path) -> set[str]:
    content = path.read_text(encoding="utf-8")
    names: set[str] = set()
    for match in NAMED_IMPORT_RE.finditer(content):
        target = resolve_import_target(path, match.group("path"))
        if target == PUBLIC_FILE.resolve():
            names.update(parse_named_list(match.group("names")))
    return names


class MapRendererPublicContractTest(unittest.TestCase):
    def test_public_whitelist_stays_explicit(self):
        content = PUBLIC_FILE.read_text(encoding="utf-8")
        match = EXPORT_BLOCK_RE.search(content)
        self.assertIsNotNone(match, "public.js must expose one explicit re-export block.")
        exported_names = parse_named_list(match.group("names"))
        self.assertEqual(EXPECTED_PUBLIC_EXPORTS, exported_names)

    def test_non_core_files_stay_on_public_facade_lane(self):
        offenders: list[str] = []
        for path in iter_js_files():
            if path == PUBLIC_FILE.resolve():
                continue
            if path.is_relative_to(CORE_ROOT.resolve()):
                continue
            for import_path, target in get_import_targets(path):
                if target == MAP_RENDERER_ENTRY.resolve():
                    offenders.append(
                        f"{relative_path(path)} -> {import_path} resolves to js/core/map_renderer.js"
                    )
                elif target.is_relative_to(MAP_RENDERER_DIR.resolve()) and target != PUBLIC_FILE.resolve():
                    offenders.append(
                        f"{relative_path(path)} -> {import_path} resolves inside js/core/map_renderer/"
                    )
        self.assertEqual([], offenders)

    def test_public_facade_named_imports_stay_whitelisted(self):
        offenders: list[str] = []
        for path in iter_js_files():
            if path.is_relative_to(CORE_ROOT.resolve()) and path != PUBLIC_FILE.resolve():
                continue
            imported_names = get_public_named_imports(path)
            unexpected = sorted(imported_names.difference(EXPECTED_PUBLIC_EXPORTS))
            if unexpected:
                offenders.append(f"{relative_path(path)} -> {', '.join(unexpected)}")
        self.assertEqual([], offenders)

    def test_only_allowed_core_files_direct_import_renderer_entry(self):
        direct_entry_importers: set[Path] = set()
        for path in iter_js_files():
            for _import_path, target in get_import_targets(path):
                if target == MAP_RENDERER_ENTRY.resolve():
                    direct_entry_importers.add(path)
        self.assertEqual(ALLOWED_INTERNAL_ENTRY_IMPORTERS, direct_entry_importers)


if __name__ == "__main__":
    unittest.main()
