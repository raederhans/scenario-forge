from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
BORDER_MESH_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_owner.js"
BORDER_MESH_DYNAMIC_RUNTIME_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_dynamic_runtime.js"
BORDER_MESH_HELPERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "polyline_simplification_helpers.js"
BORDER_MESH_SOURCE_SELECTION_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_source_selection.js"
BORDER_MESH_DIAGNOSTICS_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_diagnostics.js"


class MapRendererBorderMeshOwnerBoundaryContractTest(unittest.TestCase):
    def test_border_runtime_has_one_writer_for_dirty_timer_and_detail_cache(self):
        renderer = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner = BORDER_MESH_OWNER_JS.read_text(encoding="utf-8")
        draw = (BORDER_MESH_OWNER_JS.parent / "border_draw_owner.js").read_text(encoding="utf-8")
        self.assertIn("./renderer/border_mesh_owner.js", renderer)
        self.assertNotIn("facade_border_runtime.js", renderer)
        owned_fields = r"(?:dynamicBordersDirty|dynamicBordersDirtyReason|pendingDynamicBorderTimerId|cachedDetailAdmBorders)"
        direct_write = rf"\b(?:runtimeState|state)\.{owned_fields}\s*=(?!=)"
        for source in (renderer, draw, owner):
            self.assertNotRegex(source, direct_write)
            self.assertNotRegex(source, r"cachedDetailAdmBorders\.(?:push|pop|splice|shift|unshift|sort|reverse)\(")
        for action_name in [
            "replaceCachedDetailAdmBordersState",
            "setDynamicBordersDirtyState",
            "setPendingDynamicBorderTimerState",
        ]:
            self.assertIn(action_name, owner)
        self.assertIn('../state/actions/renderer_cache_actions.js', owner)

    def test_map_renderer_imports_polyline_simplification_helpers(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = BORDER_MESH_OWNER_JS.read_text(encoding="utf-8")
        helper_content = BORDER_MESH_HELPERS_JS.read_text(encoding="utf-8")

        self.assertIn("from './renderer/polyline_simplification_helpers.js';", renderer_content.replace('"', "'"))
        for helper_name in [
            "getSqPointToSegmentDistance",
            "simplifyPolylineRDP",
            "sanitizePolyline",
            "getPolylineMeanAbsLatitude",
            "getLatitudeAdjustedSimplifyEpsilon",
            "getTriangleArea",
            "pushMinHeap",
            "popMinHeap",
            "simplifyPolylineEffectiveArea",
        ]:
            self.assertNotIn(f"function {helper_name}(", renderer_content)
            self.assertIn(f"export function {helper_name}(", helper_content)

        runtime_call_start = owner_content.index("simplifyCoastlineMeshRuntime({")
        runtime_call_end = owner_content.index("});", runtime_call_start)
        runtime_call_source = owner_content[runtime_call_start:runtime_call_end]
        self.assertIn("sanitizePolyline,", runtime_call_source)
        self.assertIn("getLatitudeAdjustedSimplifyEpsilon,", runtime_call_source)
        self.assertIn("simplifyPolylineEffectiveArea,", runtime_call_source)

    def test_static_mesh_rebuild_keeps_viewport_internal_border_meshes_deferred(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        start = renderer_content.index("function rebuildStaticMeshes({")
        end = renderer_content.index("function invalidateBorderCache(", start)
        rebuild_source = renderer_content[start:end]

        self.assertIn("scheduleDeferredHeavyBorderMeshes();", rebuild_source)
        self.assertIn("Province/local border meshes are viewport- and zoom-dependent.", rebuild_source)
        self.assertNotIn("ensureCountrySourceBorderMeshes(countryCode,", rebuild_source)


if __name__ == "__main__":
    unittest.main()
