from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
STRATEGIC_OVERLAY_HELPERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_helpers.js"
UNIT_COUNTER_RUNTIME_DOMAIN_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime" / "unit_counter_runtime_domain.js"
EXPECTED_STRATEGIC_OVERLAY_HELPER_WHITELIST = [
    "getStrategicOverlayRuntimeOwner",
    "getMapLonLatFromEvent",
    "getLandFeatureIdFromEvent",
    "ensureOperationalLineEditorState",
    "getOperationalLinePreset",
    "projectStrategicPoints",
    "createOperationGraphicPath",
    "getOperationGraphicLabelAnchor",
    "selectOperationalLineById",
    "getOperationGraphicPreset",
    "selectOperationGraphicById",
    "renderOperationGraphicsEditorOverlay",
    "ensureUnitCounterEditorState",
    "getProjectedPoint",
    "getUnitCounterRenderEntries",
    "getUnitCounterCardModel",
    "getUnitCounterRenderScale",
    "getUnitCounterSlotOffset",
    "compareUnitCounterRenderOrder",
    "getUnitCounterNodeTransform",
    "getUnitCounterIconPath",
    "updateSpecialZonesPaths",
    "renderSpecialZoneEditorOverlay",
    "getEffectiveSpecialZonesFeatureCollection",
]


class MapRendererStrategicOverlayHelpersBoundaryContractTest(unittest.TestCase):
    @staticmethod
    def _extract_object_keys(content: str, anchor: str) -> list[str]:
        start = content.find(anchor)
        if start == -1:
            return []
        brace_start = content.find("{", start)
        if brace_start == -1:
            return []
        depth = 0
        end = None
        for idx in range(brace_start, len(content)):
            ch = content[idx]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = idx
                    break
        if end is None:
            return []
        block = content[brace_start + 1:end]
        keys = []
        for raw_line in block.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("//"):
                continue
            line = line.rstrip(",")
            if ":" in line:
                line = line.split(":", 1)[0].strip()
            keys.append(line)
        return keys

    @staticmethod
    def _extract_owner_helpers_destructured_fields(owner_content: str) -> list[str]:
        anchor = "= helpers;"
        end = owner_content.find(anchor)
        if end == -1:
            return []
        start = owner_content.rfind("const {", 0, end)
        if start == -1:
            return []
        body_start = owner_content.find("{", start)
        body = owner_content[body_start + 1:end].rsplit("}", 1)[0]
        return [
            line.strip().rstrip(",")
            for line in body.splitlines()
            if line.strip()
        ]

    def test_draw_helpers_do_not_commit_transactions(self):
        # Zoom ordering is exercised by renderer_viewport_update_owner_behavior.test.mjs;
        # render gates and editing are covered by strategic overlay owner behavior tests.
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = STRATEGIC_OVERLAY_HELPERS_JS.read_text(encoding="utf-8")
        unit_counter_domain_content = UNIT_COUNTER_RUNTIME_DOMAIN_JS.read_text(encoding="utf-8")

        self.assertNotIn('markDirty("move-unit-counter");', renderer_content)
        self.assertNotIn('renderUnitCountersIfNeeded({ force: true });', renderer_content)
        self.assertIn('markDirty("move-unit-counter");', unit_counter_domain_content)
        self.assertNotIn("pushHistoryEntry({", owner_content)
        self.assertNotIn('markDirty("move-unit-counter");', owner_content)
        self.assertNotIn('renderUnitCountersIfNeeded({ force: true });', owner_content)

    def test_defs_and_unit_drag_bindings_are_owned_with_live_surface_access(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = STRATEGIC_OVERLAY_HELPERS_JS.read_text(encoding="utf-8")
        self.assertNotIn("function renderStrategicDefs()", renderer_content)
        self.assertNotIn("function bindUnitCounterOverlayInteractions()", renderer_content)
        self.assertIn("function renderStrategicDefs()", owner_content)
        self.assertIn("function bindUnitCounterOverlayInteractions()", owner_content)
        self.assertIn("getStrategicDefs: () => rendererSurfaceHost.getStrategicDefs()", renderer_content)
        self.assertIn("groupGetters.getStrategicDefs?.()", owner_content)
        self.assertIn("groupGetters.getUnitCountersGroup?.()", owner_content)
        self.assertIn("getStrategicOverlayHelpersOwner().bindUnitCounterOverlayInteractions()", renderer_content)
        self.assertIn("getStrategicOverlayRuntimeOwner().beginUnitCounterDrag(datum.counter)", owner_content)
        self.assertIn("getStrategicOverlayRuntimeOwner().finishUnitCounterDrag(datum.counter, { featureId })", owner_content)

    def test_owner_helper_injection_matches_owner_helper_contract_whitelist(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = STRATEGIC_OVERLAY_HELPERS_JS.read_text(encoding="utf-8")

        owner_helper_fields = self._extract_owner_helpers_destructured_fields(owner_content)
        self.assertGreater(len(owner_helper_fields), 0)

        owner_creation = renderer_content.index("createStrategicOverlayHelpersOwner({")
        renderer_injected_helper_fields = self._extract_object_keys(
            renderer_content[owner_creation:], "helpers: {"
        )
        self.assertGreater(len(renderer_injected_helper_fields), 0)

        self.assertEqual(
            renderer_injected_helper_fields,
            owner_helper_fields,
            "Strategic overlay owner helper injection must stay explicit and minimal.",
        )
        self.assertEqual(
            renderer_injected_helper_fields,
            EXPECTED_STRATEGIC_OVERLAY_HELPER_WHITELIST,
            "Strategic overlay owner helper injection whitelist changed.",
        )


if __name__ == "__main__":
    unittest.main()
