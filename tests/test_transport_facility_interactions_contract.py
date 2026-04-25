from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLBAR_JS = REPO_ROOT / "js" / "ui" / "toolbar.js"
APPEARANCE_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "toolbar" / "appearance_controls_controller.js"
FACILITY_SURFACE_JS = REPO_ROOT / "js" / "core" / "renderer" / "facility_surface.js"
FACILITY_FACADE_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "facade_data_runtime.js"


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
        owner_content = FACILITY_SURFACE_JS.read_text(encoding="utf-8")
        facade_content = FACILITY_FACADE_JS.read_text(encoding="utf-8")
        required_tokens = [
            "function getHoveredFacilityEntryFromEvent",
            'recordInteractionDurationMetric("interactionHoverFacilityProbeDuration"',
            'recordInteractionDurationMetric("interactionHoverCityProbeDuration"',
            "function applyFacilityInfoCardState",
            "function zoomToFacilityEntry",
            "setVisibleFacilityHoverEntries(normalizedFamilyId, hoverEntries);",
            "const nextEntriesByKey = new Map(",
            "hoveredFacilityEntry = nextHoveredEntry;",
            "selectedFacilityEntry = nextSelectedEntry;",
            "const facilityDetailsActive = hoveredFacility ? isFacilityDetailsSurfaceActive(hoveredFacility.familyId) : false;",
            "const nextFacilityKey = buildFacilityEntryKey(hoveredFacility);",
            "const previousFacilityKey = buildFacilityEntryKey(hoveredFacilityEntry);",
            'setMapInteractionCursor(facilityDetailsActive ? "pointer" : "");',
            "if (clickedFacilityEntry && isFacilityDetailsSurfaceActive(clickedFacilityEntry.familyId)) {",
            'noteRenderAction("click-facility-info", actionStart);',
            "transportPanel.hidden !== true",
        ]
        for token in required_tokens:
            self.assertIn(token, content)
        self.assertIn("readFacadeGetter('getFacilitySurfaceOwner')().buildFacilityTooltipText(entry);", facade_content)
        self.assertIn("getFacilitySurfaceOwner().applyFacilityInfoCardState(entry, {", content)
        self.assertIn("function buildFacilityTooltipText", owner_content)
        self.assertIn("buildFacilityInfoCardFieldSections: buildFacilityInfoCardRows", owner_content)
        self.assertIn('facilityInfoCardMoreBtn.textContent = t(expanded ? "Less fields" : "More fields", "ui");', owner_content)

    def test_toolbar_summary_uses_filtered_transport_counts(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLLER_JS.read_text(encoding="utf-8")
        toolbar_required_tokens = [
            'registerRuntimeHook(state, "updateTransportAppearanceUIFn", renderTransportAppearanceUi);',
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
        state_content = (
            (REPO_ROOT / "js" / "core" / "state.js").read_text(encoding="utf-8")
            + "\n"
            + (REPO_ROOT / "js" / "core" / "state_defaults.js").read_text(encoding="utf-8")
        )
        i18n_content = (
            (REPO_ROOT / "js" / "ui" / "i18n.js").read_text(encoding="utf-8")
            + "\n"
            + (REPO_ROOT / "js" / "ui" / "i18n_catalog.js").read_text(encoding="utf-8")
        )
        self.assertIn('primaryColor: "#1d4ed8"', state_content)
        self.assertIn('primaryColor: "#b45309"', state_content)
        self.assertIn("function normalizeTransportOverviewPrimaryColor", state_content)
        for token in ['"Primary Color"', '"More fields"', '"Less fields"', '"Locate and zoom"', '"airport"', '"airports"', '"port"', '"ports"', '"Owner"', '"Manager"', '"Status"', '"Agencies"', '"Ferry service"', '"Unnamed facility"']:
          self.assertIn(token, i18n_content)

    def test_toolbar_syncs_facility_card_visibility_when_transport_surface_changes(self):
        toolbar_content = TOOLBAR_JS.read_text(encoding="utf-8")
        owner_content = APPEARANCE_CONTROLLER_JS.read_text(encoding="utf-8")
        self.assertIn("runtimeState.syncFacilityInfoCardVisibilityFn?.();", owner_content)
        self.assertIn("panel.hidden = !isActive;", toolbar_content)

    def test_map_renderer_coalesces_mousemove_hover_overlay_only(self):
        content = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")
        required_tokens = [
            "let hoverOverlayRenderRafHandle = null;",
            "function scheduleHoverOverlayRender()",
            "if (hoverOverlayRenderRafHandle !== null && hoverOverlayRenderRafHandle !== undefined) {",
            'hoverOverlayRenderRafHandle = typeof globalThis.requestAnimationFrame === "function"',
            'renderHoverOverlayIfNeeded({ eventType: "hover" });',
            "function cancelScheduledHoverOverlayRender()",
            "cancelScheduledHoverOverlayRender();",
            'recordInteractionDurationMetric("interactionHoverOverlayDuration"',
            'renderHoverOverlayIfNeeded({ eventType: "facility-card-visibility" });',
            'renderHoverOverlayIfNeeded({ eventType: "facility-card-open" });',
            'renderHoverOverlayIfNeeded({ eventType: "facility-card-clear" });',
            'renderHoverOverlayIfNeeded({ force: true, eventType: "zoom-start" });',
            'renderHoverOverlayIfNeeded({ eventType: "mouseleave" });',
            'renderHoverOverlayIfNeeded({ eventType: "facility-card-close" });',
        ]
        for token in required_tokens:
            self.assertIn(token, content)
        self.assertIn('interactionRect.on("mouseleave", () => {', content)
        self.assertIn('facilityInfoCardCloseBtn.addEventListener("click", () => {', content)


if __name__ == "__main__":
    unittest.main()
