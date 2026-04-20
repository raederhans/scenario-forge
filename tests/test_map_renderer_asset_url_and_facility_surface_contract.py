from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
ASSET_URL_POLICY_JS = REPO_ROOT / "js" / "core" / "renderer" / "asset_url_policy.js"
FACILITY_SURFACE_JS = REPO_ROOT / "js" / "core" / "renderer" / "facility_surface.js"


class MapRendererAssetUrlAndFacilitySurfaceContractTest(unittest.TestCase):
    def test_map_renderer_uses_asset_url_policy_owner_for_bathymetry_urls(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = ASSET_URL_POLICY_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createRendererAssetUrlPolicyOwner } from './renderer/asset_url_policy.js';",
            renderer_imports,
        )
        self.assertIn("let rendererAssetUrlPolicyOwner = null;", renderer_content)
        self.assertIn("function getRendererAssetUrlPolicyOwner() {", renderer_content)
        self.assertIn("return getRendererAssetUrlPolicyOwner().getScenarioBathymetryTopologyUrl();", renderer_content)
        self.assertIn("return getRendererAssetUrlPolicyOwner().getDesiredBathymetryTopologyUrl(slot);", renderer_content)
        self.assertIn("getRendererAssetUrlPolicyOwner().isDesiredBathymetryUrl(slot, normalizedUrl)", renderer_content)
        self.assertIn('const globalUrl = getDesiredBathymetryTopologyUrl("global");', renderer_content)
        self.assertIn("state.globalBathymetryTopologyUrl === globalUrl", renderer_content)
        self.assertIn("scheduleBathymetryTopologyLoad(globalUrl, { slot: \"global\" });", renderer_content)

        self.assertIn("export function createRendererAssetUrlPolicyOwner({", owner_content)
        self.assertIn("function normalizeBathymetryTopologyUrl(rawValue, label = \"bathymetry\") {", owner_content)
        self.assertIn("function getScenarioBathymetryTopologyUrl() {", owner_content)
        self.assertIn("function getDesiredBathymetryTopologyUrl(slot) {", owner_content)
        self.assertIn("function isDesiredBathymetryUrl(slot, url) {", owner_content)
        self.assertIn("!value.startsWith(\"data/\")", owner_content)

    def test_map_renderer_uses_facility_surface_owner_for_tooltip_and_card_dom(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = FACILITY_SURFACE_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createFacilitySurfaceOwner } from './renderer/facility_surface.js';",
            renderer_imports,
        )
        self.assertIn("let facilitySurfaceOwner = null;", renderer_content)
        self.assertIn("function getFacilitySurfaceOwner() {", renderer_content)
        self.assertIn("return getFacilitySurfaceOwner().buildFacilityTooltipText(entry);", renderer_content)
        self.assertIn("return getFacilitySurfaceOwner().buildFacilityInfoCardTitle(entry);", renderer_content)
        self.assertIn("return getFacilitySurfaceOwner().buildFacilityInfoCardFieldSections(entry, expanded);", renderer_content)
        self.assertIn("getFacilitySurfaceOwner().applyFacilityInfoCardState(null, {", renderer_content)
        self.assertIn("const cardState = getFacilitySurfaceOwner().applyFacilityInfoCardState(entry, {", renderer_content)
        self.assertNotIn("facilityInfoCardBody.innerHTML =", renderer_content)

        self.assertIn("export function createFacilitySurfaceOwner({", owner_content)
        self.assertIn("function buildFacilityTooltipText(entry) {", owner_content)
        self.assertIn("function buildFacilityInfoCardTitle(entry) {", owner_content)
        self.assertIn("function buildFacilityInfoCardRows(entry, expanded = false) {", owner_content)
        self.assertIn("function renderFacilityInfoCardRows(container, rows = []) {", owner_content)
        self.assertIn("function applyFacilityInfoCardState(entry, {", owner_content)
        self.assertIn("container.replaceChildren();", owner_content)
        self.assertIn("valueNode.textContent = String(row?.value || \"\");", owner_content)


if __name__ == "__main__":
    unittest.main()
