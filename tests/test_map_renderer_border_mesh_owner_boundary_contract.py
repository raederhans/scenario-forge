from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
BORDER_MESH_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_owner.js"
BORDER_MESH_SOURCE_SELECTION_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_source_selection.js"
BORDER_MESH_DIAGNOSTICS_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_diagnostics.js"


class MapRendererBorderMeshOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_border_render_owner_while_mesh_builders_move_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = BORDER_MESH_OWNER_JS.read_text(encoding="utf-8")
        source_selection_content = BORDER_MESH_SOURCE_SELECTION_JS.read_text(encoding="utf-8")
        diagnostics_content = BORDER_MESH_DIAGNOSTICS_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createBorderMeshOwner } from './renderer/border_mesh_owner.js';",
            renderer_imports,
        )
        self.assertIn("let borderMeshOwner = null;", renderer_content)
        self.assertIn("function getBorderMeshOwner() {", renderer_content)
        self.assertIn("clearPendingDynamicBorderTimer,", renderer_content)
        self.assertIn("ensureSovereigntyState,", renderer_content)
        self.assertIn("invalidateRenderPasses,", renderer_content)
        self.assertIn("isDynamicBordersEnabled,", renderer_content)
        self.assertIn("nowMs,", renderer_content)
        self.assertIn("recordRenderPerfMetric,", renderer_content)
        self.assertIn("updateDynamicBorderStatusUI,", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildOwnerBorderMesh(runtimeTopology, ownershipContext, { excludeSea });", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext);", renderer_content)
        self.assertIn("return getBorderMeshOwner().countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext);", renderer_content)
        self.assertIn("return getBorderMeshOwner().rebuildDynamicBorders();", renderer_content)
        self.assertIn("const built = getBorderMeshOwner().refreshScenarioOpeningOwnerBorders(reason);", renderer_content)
        self.assertIn("if (renderNow && context) {", renderer_content)
        self.assertIn("return built;", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildDetailAdmBorderMesh(topology, includedCountries);", renderer_content)
        self.assertIn("return getBorderMeshOwner().getSourceCountrySets();", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildCountryParentBorderMeshes(countryCode);", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildSourceBorderMeshes(topology, includedCountries);", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildGlobalCountryBorderMesh(primaryTopology);", renderer_content)
        self.assertIn("return getBorderMeshOwner().resolveCoastlineTopologySource();", renderer_content)
        self.assertIn("return getBorderMeshOwner().buildGlobalCoastlineMesh(primaryTopology);", renderer_content)
        self.assertIn("return getBorderMeshOwner().simplifyCoastlineMesh(mesh, { epsilon, minLength });", renderer_content)
        self.assertIn("function rebuildStaticMeshes() {", renderer_content)
        self.assertIn("function drawHierarchicalBorders(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("function drawBordersPass(k, { interactive = false } = {}) {", renderer_content)

        self.assertIn("export function createBorderMeshOwner({", owner_content)
        self.assertIn("function buildOwnerBorderMesh(runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) {", owner_content)
        self.assertIn("function buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext) {", owner_content)
        self.assertIn("function countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext = {}) {", owner_content)
        self.assertIn("function rebuildDynamicBorders() {", owner_content)
        self.assertIn("function refreshScenarioOpeningOwnerBorders(reason = \"\") {", owner_content)
        self.assertIn("resolveScenarioOpeningOwnerBorderSelection({", owner_content)
        self.assertIn("let scenarioOpeningOwnerBorderCache = {", owner_content)
        self.assertIn("function buildDetailAdmBorderMesh(topology, includedCountries) {", owner_content)
        self.assertIn("function getSourceCountrySets() {", owner_content)
        self.assertIn("function buildCountryParentBorderMeshes(countryCode) {", owner_content)
        self.assertIn("function buildSourceBorderMeshes(topology, includedCountries) {", owner_content)
        self.assertIn("function buildGlobalCountryBorderMesh(primaryTopology) {", owner_content)
        self.assertIn("function resolveCoastlineTopologySource() {", owner_content)
        self.assertIn("function buildGlobalCoastlineMesh(primaryTopology) {", owner_content)
        self.assertIn("function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {", owner_content)
        self.assertIn("const runtimeRef = state.runtimePoliticalTopology || null;", source_selection_content)
        self.assertIn("const hasMeshPackMesh = isUsableMesh(meshPackMesh);", source_selection_content)
        self.assertIn("const hasBaselineOwners = Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0;", source_selection_content)
        self.assertIn("!!runtimeRef?.objects?.political && hasBaselineOwners", source_selection_content)
        self.assertIn("function getCoastlineTopologyMetrics({", diagnostics_content)
        self.assertIn("function evaluateCoastlineTopologySource({", diagnostics_content)


if __name__ == "__main__":
    unittest.main()
