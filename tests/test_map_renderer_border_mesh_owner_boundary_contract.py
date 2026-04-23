from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
FACADE_BORDER_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "facade_border_runtime.js"
BORDER_MESH_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_owner.js"
BORDER_MESH_DYNAMIC_RUNTIME_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_dynamic_runtime.js"
BORDER_MESH_SOURCE_SELECTION_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_source_selection.js"
BORDER_MESH_DIAGNOSTICS_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_mesh_diagnostics.js"


class MapRendererBorderMeshOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_border_render_owner_while_border_facade_hosts_wrappers(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        facade_content = FACADE_BORDER_RUNTIME_JS.read_text(encoding="utf-8")
        owner_content = BORDER_MESH_OWNER_JS.read_text(encoding="utf-8")
        source_selection_content = BORDER_MESH_SOURCE_SELECTION_JS.read_text(encoding="utf-8")
        diagnostics_content = BORDER_MESH_DIAGNOSTICS_JS.read_text(encoding="utf-8")
        dynamic_runtime_content = BORDER_MESH_DYNAMIC_RUNTIME_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("import { createBorderMeshOwner } from './renderer/border_mesh_owner.js';", renderer_imports)
        self.assertIn("from './map_renderer/facade_border_runtime.js';", renderer_imports)
        self.assertIn("let borderMeshOwner = null;", renderer_content)
        self.assertIn("function getBorderMeshOwner() {", renderer_content)
        self.assertIn("function rebuildStaticMeshes() {", renderer_content)
        self.assertIn("function drawHierarchicalBorders(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("function drawBordersPass(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("function getFeatureBorderMeshCountryCodeNormalized(feature) {", renderer_content)
        self.assertIn("function getEntityBorderMeshCountryCode(entity) {", renderer_content)
        self.assertIn("getScenarioSurfaceVersionSignal,", renderer_content)
        self.assertNotIn("function buildOwnerBorderMesh(", renderer_content)
        self.assertNotIn("function buildDynamicOwnerBorderMesh(", renderer_content)
        self.assertNotIn("function countUnresolvedOwnerBorderEntities(", renderer_content)
        self.assertNotIn("function buildDetailAdmBorderMesh(", renderer_content)
        self.assertNotIn("function buildCountryParentBorderMeshes(", renderer_content)
        self.assertNotIn("function getSourceCountrySets(", renderer_content)
        self.assertNotIn("function buildSourceBorderMeshes(", renderer_content)
        self.assertNotIn("function buildGlobalCountryBorderMesh(", renderer_content)
        self.assertNotIn("function resolveCoastlineTopologySource(", renderer_content)
        self.assertNotIn("function buildGlobalCoastlineMesh(", renderer_content)
        self.assertNotIn("function simplifyCoastlineMesh(", renderer_content)

        self.assertIn("export function configureBorderRuntimeFacade(nextState = {}) {", facade_content)
        self.assertIn("export function buildOwnerBorderMesh(runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) {", facade_content)
        self.assertIn("export function buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext) {", facade_content)
        self.assertIn("export function countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext = {}) {", facade_content)
        self.assertIn("export function buildDetailAdmBorderMesh(topology, includedCountries) {", facade_content)
        self.assertIn("export function buildCountryParentBorderMeshes(countryCode) {", facade_content)
        self.assertIn("export function getSourceCountrySets() {", facade_content)
        self.assertIn("export function buildSourceBorderMeshes(topology, includedCountries) {", facade_content)
        self.assertIn("export function buildGlobalCountryBorderMesh(primaryTopology) {", facade_content)
        self.assertIn("export function resolveCoastlineTopologySource() {", facade_content)
        self.assertIn("export function buildGlobalCoastlineMesh(primaryTopology) {", facade_content)
        self.assertIn("export function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {", facade_content)

        self.assertIn("export function createBorderMeshOwner({", owner_content)
        self.assertIn("./border_mesh_dynamic_runtime.js", owner_content)
        self.assertIn("getEntityBorderMeshCountryCode = getEntityCountryCode,", owner_content)
        self.assertIn("getFeatureBorderMeshCountryCodeNormalized = getFeatureCountryCodeNormalized,", owner_content)
        self.assertIn("getScenarioSurfaceVersionSignal = () => \"\",", owner_content)
        self.assertIn("function rebuildDynamicBorders() {", owner_content)
        self.assertIn("function refreshScenarioOpeningOwnerBorders(reason = \"\") {", owner_content)
        self.assertIn("const buildOwnerBorderMesh = (runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) =>", owner_content)
        self.assertIn("const buildDynamicOwnerBorderMesh = (runtimeTopology, ownershipContext) =>", owner_content)
        self.assertIn("const countUnresolvedOwnerBorderEntities = (runtimeTopology, ownershipContext = {}) =>", owner_content)
        self.assertIn("const buildDetailAdmBorderMesh = (topology, includedCountries) =>", owner_content)
        self.assertIn("getEntityCountryCode: getEntityBorderMeshCountryCode,", owner_content)
        self.assertIn("getFeatureCountryCodeNormalized: getFeatureBorderMeshCountryCodeNormalized,", owner_content)
        self.assertIn("const simplifyCoastlineMesh = (mesh, { epsilon = 0, minLength = 0 } = {}) =>", owner_content)
        self.assertIn("scenarioSurfaceVersionSignal", owner_content)
        self.assertNotIn("function buildDynamicBorderHash() {", owner_content)
        self.assertNotIn("function getDynamicBorderOwnershipContext() {", owner_content)
        self.assertNotIn("function buildOwnerBorderMesh(runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) {", owner_content)
        self.assertNotIn("function buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext) {", owner_content)
        self.assertNotIn("function countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext = {}) {", owner_content)
        self.assertNotIn("function buildDetailAdmBorderMesh(topology, includedCountries) {", owner_content)
        self.assertNotIn("function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {", owner_content)

        self.assertIn("export function buildDynamicBorderHash({", dynamic_runtime_content)
        self.assertIn("export function getDynamicBorderOwnershipContext(state = {}) {", dynamic_runtime_content)
        self.assertIn("export function buildOwnerBorderMesh({", dynamic_runtime_content)
        self.assertIn("export function buildDynamicOwnerBorderMesh({", dynamic_runtime_content)
        self.assertIn("export function countUnresolvedOwnerBorderEntities({", dynamic_runtime_content)
        self.assertIn("export function buildDetailAdmBorderMesh({", dynamic_runtime_content)
        self.assertIn("export function simplifyCoastlineMesh({", dynamic_runtime_content)
        self.assertIn("const runtimeRef = state.runtimePoliticalTopology || null;", source_selection_content)
        self.assertIn("const hasMeshPackMesh = isUsableMesh(meshPackMesh);", source_selection_content)
        self.assertIn("const hasBaselineOwners = Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0;", source_selection_content)
        self.assertIn("!!runtimeRef?.objects?.political && hasBaselineOwners", source_selection_content)
        self.assertIn("function getCoastlineTopologyMetrics({", diagnostics_content)
        self.assertIn("function evaluateCoastlineTopologySource({", diagnostics_content)


if __name__ == "__main__":
    unittest.main()
