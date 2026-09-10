from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
BORDER_DRAW_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_draw_owner.js"
OCEAN_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "ocean_render_owner.js"
STATIC_BORDER_LIFECYCLE_JS = REPO_ROOT / "js" / "core" / "renderer" / "static_border_mesh_lifecycle.js"


class MapRendererBorderDrawOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_border_pass_owner_while_draw_helpers_move_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = BORDER_DRAW_OWNER_JS.read_text(encoding="utf-8")
        ocean_owner_content = OCEAN_RENDER_OWNER_JS.read_text(encoding="utf-8")
        lifecycle_content = STATIC_BORDER_LIFECYCLE_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createBorderDrawOwner } from './renderer/border_draw_owner.js';",
            renderer_imports,
        )
        self.assertIn("let borderDrawOwner = null;", renderer_content)
        self.assertIn("function getBorderDrawOwner() {", renderer_content)
        self.assertIn("getContext: () => rendererSurfaceHost.getContext(),", renderer_content)
        self.assertIn("getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),", renderer_content)
        self.assertIn("getProjection: () => rendererSurfaceHost.getProjection(),", renderer_content)
        self.assertIn("clamp,", renderer_content)
        self.assertIn("isUsableMesh,", renderer_content)
        self.assertIn("sanitizePolyline,", renderer_content)
        self.assertNotIn("const drawMeshCollection = (...args) => getBorderDrawOwner().drawMeshCollection(...args);", renderer_content)
        self.assertNotIn("const declutterProjectedPolyline = (...args) => getBorderDrawOwner().declutterProjectedPolyline(...args);", renderer_content)
        self.assertNotIn("const getProjectedPolylineMetrics = (...args) => getBorderDrawOwner().getProjectedPolylineMetrics(...args);", renderer_content)
        self.assertNotIn("const buildRenderableBoundaryMesh = (...args) => getBorderDrawOwner().buildRenderableBoundaryMesh(...args);", renderer_content)
        self.assertNotIn("getBorderDrawOwner().getViewportAwareCoastlineCollection(...args);", renderer_content)
        self.assertNotIn("const getBoundaryMeshTransform = (...args) => getBorderDrawOwner().getBoundaryMeshTransform(...args);", renderer_content)
        self.assertIn("getViewportAwareCoastlineCollection: (collection, k) => (", renderer_content)
        self.assertIn("getBorderDrawOwner().getViewportAwareCoastlineCollection(collection, k)", renderer_content)
        self.assertIn("return getBorderDrawOwner().drawHierarchicalBorders(k, { interactive });", renderer_content)
        self.assertIn("function drawHierarchicalBorders(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("function drawBordersPass(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("getVisibleCountryCodesForBorderMeshes,", renderer_content)
        self.assertIn("return getStaticBorderMeshLifecycle().getVisibleCountryCodesForBorderMeshes();", renderer_content)
        self.assertIn("item?.borderMeshCountryCode || item?.countryCode || \"\"", lifecycle_content)

        self.assertIn("export function createBorderDrawOwner({", owner_content)
        self.assertIn("state,", owner_content)
        self.assertIn("reconcileDetailAdmBorders = () => {},", owner_content)
        self.assertIn("reconcileDetailAdmBorders(detailAdmMeta);", owner_content)
        self.assertIn("reconcileDetailAdmBorders: (meta) => getBorderMeshOwner().reconcileDetailAdmBorders(meta),", renderer_content)
        self.assertIn("getScenarioOwnerOnlyCanonicalFallbackWarnings = () => new Set(),", owner_content)
        self.assertIn("function drawMeshCollection(meshCollection, strokeStyle, lineWidth, options = {}) {", owner_content)
        self.assertIn("function declutterProjectedPolyline(line, minDistancePx, angleThresholdDeg) {", owner_content)
        self.assertIn("function getProjectedPolylineMetrics(line) {", owner_content)
        self.assertIn("function buildRenderableBoundaryMesh(mesh, {", owner_content)
        self.assertIn("function getViewportAwareCoastlineCollection(collection, k) {", owner_content)
        self.assertIn("function getBoundaryMeshTransform(kind, k) {", owner_content)
        self.assertIn("function drawHierarchicalBorders(k, { interactive = false } = {}) {", owner_content)
        self.assertIn("const countryOpacity = clamp(", owner_content)
        self.assertIn("const coastOpacity = clamp(", owner_content)
        self.assertIn("context.globalAlpha = countryOpacity * 0.88;", owner_content)
        self.assertIn("context.globalAlpha = coastOpacity * 0.78;", owner_content)
        self.assertIn("const countryAlpha = countryOpacity;", owner_content)
        self.assertIn("const coastAlpha = coastOpacity * clamp(", owner_content)
        self.assertIn("function drawScenarioCoastalAccentLayer(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("return getOceanRenderOwner().drawScenarioCoastalAccentLayer(k, { interactive });", renderer_content)
        self.assertIn("export function createOceanRenderOwner({", ocean_owner_content)
        self.assertIn("getViewportAwareCoastlineCollection(baseCoastlineCollection, k);", ocean_owner_content)
        self.assertIn("const coastStyle = runtimeState.styleConfig?.coastlines || {};", ocean_owner_content)
        self.assertIn("const coastAccentColor = getSafeCanvasColor(coastStyle.color, TNO_COASTAL_ACCENT_COLOR);", ocean_owner_content)
        self.assertIn("context.globalAlpha = bucket.alpha * coastAccentOpacity;", ocean_owner_content)
        self.assertIn("context.lineWidth = bucket.lineWidth * coastAccentWidthScale;", ocean_owner_content)


if __name__ == "__main__":
    unittest.main()
