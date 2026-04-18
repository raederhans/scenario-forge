from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
APPEARANCE_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_controls_controller.js"


class TransportFacilityInteractionsContractTest(unittest.TestCase):
    def test_index_ships_facility_info_card_surface(self):
        content = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
        required_tokens = [
            'id="facilityInfoCard"',
            'id="facilityInfoCardTitle"',
            'id="facilityInfoCardBody"',
            'id="facilityInfoCardMoreBtn"',
            'id="facilityInfoCardZoomBtn"',
            'id="facilityInfoCardCloseBtn"',
            'id="airportPrimaryColor"',
            'id="portPrimaryColor"',
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_css_ships_facility_info_card_styles(self):
        content = (REPO_ROOT / "css" / "style.css").read_text(encoding="utf-8")
        required_tokens = [
            ".facility-info-card {",
            ".facility-info-card-row {",
            ".facility-info-card-label {",
            ".facility-info-card-actions {",
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_map_renderer_wires_facility_hover_and_card_logic(self):
        content = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")
        required_tokens = [
            "function getHoveredFacilityEntryFromEvent",
            "function buildFacilityTooltipText",
            "function buildFacilityInfoCardFieldSections",
            "function applyFacilityInfoCardState",
            "function zoomToFacilityEntry",
            "setVisibleFacilityHoverEntries(normalizedFamilyId, hoverEntries);",
            "const nextEntriesByKey = new Map(",
            "hoveredFacilityEntry = nextHoveredEntry;",
            "selectedFacilityEntry = nextSelectedEntry;",
            "const facilityDetailsActive = hoveredFacility ? isFacilityDetailsSurfaceActive(hoveredFacility.familyId) : false;",
            'setMapInteractionCursor(facilityDetailsActive ? "pointer" : "");',
            'facilityInfoCardMoreBtn.textContent = t(facilityInfoCardExpanded ? "Less fields" : "More fields", "ui");',
            "if (clickedFacilityEntry && isFacilityDetailsSurfaceActive(clickedFacilityEntry.familyId)) {",
            'noteRenderAction("click-facility-info", actionStart);',
            "transportPanel.hidden !== true",
        ]
        for token in required_tokens:
            self.assertIn(token, content)

    def test_toolbar_summary_uses_filtered_transport_counts(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLLER_JS.read_text(encoding="utf-8")
        toolbar_required_tokens = [
            "state.updateTransportAppearanceUIFn = renderTransportAppearanceUi;",
        ]
        owner_required_tokens = [
            "const getTransportFamilyFilteredCount = (familyId, familyConfig, effectiveScope) => {",
            "const formatTransportFamilyCountText = (familyId, count) => {",
            'getTransportAppearanceConfig().airport.primaryColor = normalizeOceanFillColor(event.target.value || "#1d4ed8");',
            'getTransportAppearanceConfig().port.primaryColor = normalizeOceanFillColor(event.target.value || "#b45309");',
            "getTransportFamilyFilteredCount(familyId, familyConfig, effectiveScope)",
        ]
        for token in toolbar_required_tokens:
            self.assertIn(token, toolbar_content)
        for token in owner_required_tokens:
            self.assertIn(token, owner_content)

    def test_state_and_i18n_cover_transport_primary_color_and_more_fields(self):
        state_content = (REPO_ROOT / "js" / "core" / "state.js").read_text(encoding="utf-8")
        i18n_content = (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8")
        self.assertIn('primaryColor: "#1d4ed8"', state_content)
        self.assertIn('primaryColor: "#b45309"', state_content)
        self.assertIn("function normalizeTransportOverviewPrimaryColor", state_content)
        for token in ['"Primary Color"', '"More fields"', '"Less fields"', '"Locate and zoom"', '"airport"', '"airports"', '"port"', '"ports"', '"Owner"', '"Manager"', '"Status"', '"Agencies"', '"Ferry service"', '"Unnamed facility"']:
          self.assertIn(token, i18n_content)

    def test_toolbar_syncs_facility_card_visibility_when_transport_surface_changes(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLLER_JS.read_text(encoding="utf-8")
        self.assertIn("state.syncFacilityInfoCardVisibilityFn?.();", owner_content)
        self.assertIn("panel.hidden = !isActive;", toolbar_content)


if __name__ == "__main__":
    unittest.main()
