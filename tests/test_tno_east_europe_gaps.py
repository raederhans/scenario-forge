"""Coverage validity must not conceal unassigned land or invent water repairs."""
import json
import math

import pytest
import shapely
from shapely.geometry import Polygon, box, mapping, shape

from tools.audit_tno_east_europe_gaps import ROOT, audit, checked_runtime_output, load_window, metrics
from map_builder.geo.measurement import densify_for_measurement


BOUNDS = (25, 50, 26, 51)


# Stored canonical Levant audit sample: seven vertices and long narrow edges.
# Before measurement densification it was reported as 84.70227685587692 km2.
LEVANT_GAP = Polygon([
    (38.79218792187922, 33.371381261812616),
    (36.812168121681225, 32.324670731707315),
    (37.49617496174963, 32.69266846368464),
    (38.32418324183243, 33.13357140671407),
    (40.163801638016395, 34.07613163531636),
    (40.667806678066796, 34.32956403564036),
    (38.79218792187922, 33.371381261812616),
])


# Valid canonical DZA-2147/MAR-1454 overlap from the South-Europe audit;
# GEOS segmentize collapses this near-collinear polygon to POLYGON EMPTY.
COLLAPSED_OVERLAP = Polygon([
    (-2.03582035820358, 34.926692430924305),
    (-2.037921090870367, 34.927907929550436),
    (-2.179821798217972, 35.01001267212672),
])


def test_real_overlap_measurement_collapse_preserves_source_and_skips_mic(monkeypatch):
    original = COLLAPSED_OVERLAP.wkb
    assert COLLAPSED_OVERLAP.is_valid and COLLAPSED_OVERLAP.area > 0
    assert shapely.segmentize(COLLAPSED_OVERLAP, 0.001).is_empty
    monkeypatch.setattr('tools.audit_tno_east_europe_gaps.densify_for_measurement', lambda *args: Polygon())
    def forbidden_mic(*args, **kwargs):
        raise AssertionError("MIC must not receive the empty measurement copy")
    monkeypatch.setattr(shapely, "maximum_inscribed_circle", forbidden_mic)
    measured = metrics(COLLAPSED_OVERLAP)
    assert measured["measurement_collapsed"]
    assert measured["area_km2"] == 0
    assert measured["maximum_inscribed_diameter_m"] is None
    assert measured["source_area_degrees2"] == COLLAPSED_OVERLAP.area
    assert measured["bounds"] == list(COLLAPSED_OVERLAP.bounds)
    assert COLLAPSED_OVERLAP.wkb == original


def test_collapsed_overlap_retains_edge_diagnostic_and_raw_geometry(monkeypatch):
    monkeypatch.setattr('tools.audit_tno_east_europe_gaps.densify_for_measurement', lambda *args: Polygon())
    bounds = (-3, 34, -1, 36)
    land = box(*bounds)
    report = audit({"land": row(land), "sliver": row(COLLAPSED_OVERLAP)}, land, bounds, include_geometry=True)
    assert report["gaps"] == []
    assert not report["coverage_valid_exact"]
    edge = report["edge_findings"][0]
    assert edge["classification"] == "adjacent_edge_mismatch"
    assert edge["overlap_area_km2"] == 0
    assert len(edge["collapsed_overlap_measurements"]) == 1
    collapsed = edge["collapsed_overlap_measurements"][0]
    assert collapsed["source_area_degrees2"] > 0
    assert shape(collapsed["geometry"]).equals(COLLAPSED_OVERLAP)
    assert report["diagnostic_counts"]["measurement_collapsed"]["overlap_components"] == 1
    json.dumps(report, allow_nan=False)


def test_collapsed_gap_below_area_filter_remains_observable(monkeypatch):
    monkeypatch.setattr('tools.audit_tno_east_europe_gaps.densify_for_measurement', lambda *args: Polygon())
    original = COLLAPSED_OVERLAP.wkb
    report = audit({}, COLLAPSED_OVERLAP, (-3, 34, -1, 36), min_area_km2=1, include_geometry=True)
    assert report["gaps"] == []
    assert len(report["collapsed_gap_measurements"]) == 1
    measurement = report["collapsed_gap_measurements"][0]
    assert measurement["measurement_collapsed"]
    assert measurement["source_area_degrees2"] > 0
    assert shape(measurement["geometry"]).equals(COLLAPSED_OVERLAP)
    assert report["diagnostic_counts"]["measurement_collapsed"]["gap_components"] == 1
    assert COLLAPSED_OVERLAP.wkb == original


def test_other_measurement_geos_errors_still_fail(monkeypatch):
    def failing_mic(*args, **kwargs):
        raise shapely.errors.GEOSException("unrelated numerical failure")
    monkeypatch.setattr(shapely, "maximum_inscribed_circle", failing_mic)
    with pytest.raises(shapely.errors.GEOSException, match="unrelated numerical failure"):
        metrics(box(*BOUNDS))


@pytest.mark.parametrize('sample', json.loads((ROOT / 'tests/fixtures/geos_segmentize_collapse.json').read_text()),
                         ids=lambda sample: sample['id'])
def test_actual_source_fragments_retain_area_and_original_vertices(sample):
    original = shape(sample['geometry'])
    before = original.wkb
    assert original.is_valid and original.area > 0
    # These valid fragments formerly lost almost all area without becoming empty.
    assert shapely.segmentize(original, 0.001).area < original.area * 1e-6
    measured = densify_for_measurement(original)
    assert measured.area == pytest.approx(original.area, abs=2e-15, rel=0)
    assert set(original.exterior.coords) <= set(measured.exterior.coords)
    coarse, fine = metrics(original), metrics(original, max_segment_length_degrees=0.0005)
    assert coarse['area_km2'] > original.area * 5000
    assert abs(coarse['area_km2'] - fine['area_km2']) < 1e-5
    assert coarse['densification_method'] == 'linear_original_vertices_preserved'
    assert original.wkb == before


def test_measurement_retains_holes_and_multipart_area():
    first = box(25, 50, 25.02, 50.02).difference(box(25.005, 50.005, 25.015, 50.015))
    source = shapely.MultiPolygon([first, box(26, 50, 26.01, 50.01)])
    measured = densify_for_measurement(source)
    assert len(measured.geoms) == 2 and len(measured.geoms[0].interiors) == 1
    assert measured.area == pytest.approx(source.area, abs=1e-15, rel=0)
    assert densify_for_measurement(Polygon()).is_empty


@pytest.mark.parametrize('step', [0, -1, float('nan'), float('inf')])
def test_measurement_rejects_invalid_step(step):
    with pytest.raises(ValueError, match='finite and positive'):
        densify_for_measurement(box(*BOUNDS), step)


def test_near_collinear_measurement_exposes_unresolved_width_without_modifying_source():
    before = COLLAPSED_OVERLAP.wkb
    result = metrics(COLLAPSED_OVERLAP)
    assert not result['measurement_collapsed']
    assert not result['measurement_valid']
    assert result['maximum_inscribed_diameter_m'] is None
    assert COLLAPSED_OVERLAP.wkb == before


@pytest.mark.parametrize("geometry", [
    Polygon([(30, 31), (42, 36), (42.003, 36), (30.003, 31)]),
    LEVANT_GAP,
], ids=["synthetic-long-narrow", "canonical-levant-seven-vertices"])
def test_measurement_area_is_stable_under_collinear_vertices_and_partition(geometry):
    original = geometry.wkb
    coarse = metrics(geometry)
    fine = metrics(geometry, max_segment_length_degrees=0.0005)
    refined = shapely.segmentize(geometry, 0.2)
    west, south, east, north = geometry.bounds
    middle = (west + east) / 2
    parts = [geometry.intersection(box(west - 1, south - 1, middle, north + 1)),
             geometry.intersection(box(middle, south - 1, east + 1, north + 1))]
    assert geometry.is_valid and all(part.is_valid for part in parts)
    assert shapely.union_all(parts).symmetric_difference(geometry).area < 1e-12
    assert parts[0].intersection(parts[1]).area == 0
    # The same straight geographic edges must retain area when new collinear
    # vertices are introduced, or when a source partition splits the polygon.
    assert abs(coarse["area_km2"] - fine["area_km2"]) < 1e-5
    assert metrics(refined)["area_km2"] == pytest.approx(coarse["area_km2"], abs=1e-5, rel=0)
    assert sum(metrics(part)["area_km2"] for part in parts) == pytest.approx(coarse["area_km2"], abs=1e-5, rel=0)
    assert abs(coarse["maximum_inscribed_diameter_m"] - fine["maximum_inscribed_diameter_m"]) < 2
    assert coarse["measurement_projection_center"] == [(west + east) / 2, (south + north) / 2]
    assert metrics(refined)["measurement_projection_center"] == coarse["measurement_projection_center"]
    point = geometry.representative_point()
    assert coarse["representative_point"] == [point.x, point.y]
    assert coarse["measurement_max_segment_length_degrees"] == 0.001
    assert coarse["area_method"] == "laea_densified_linear_lonlat_edges"
    assert coarse["densification_scope"] == "measurement_only"
    assert geometry.wkb == original


def test_canonical_levant_area_converges_and_audit_keeps_raw_vertices():
    measured = metrics(LEVANT_GAP)
    assert measured["area_km2"] == pytest.approx(172.4233753, abs=1e-5, rel=0)
    bounds = (36, 32, 41, 35)
    allowed = box(*bounds)
    land = allowed.difference(LEVANT_GAP)
    original = land.wkb
    gap = audit({"land": row(land)}, allowed, bounds, include_geometry=True)["gaps"][0]
    output_geometry = shape(gap["geometry"])
    assert output_geometry.equals(LEVANT_GAP)
    assert shapely.get_num_coordinates(output_geometry) == shapely.get_num_coordinates(LEVANT_GAP)
    assert gap["classification"] == "real_polygon_coverage_gap"
    assert gap["triage_category"] == "enclosed_political_gap"
    assert not gap["touches_allowed_surface_boundary"]
    assert gap["area_km2"] == pytest.approx(measured["area_km2"], abs=1e-5, rel=0)
    assert gap["representative_point"] == measured["representative_point"]
    assert land.wkb == original


def row(geometry, country="UA"):
    return {"geometry": geometry, "country": country}


def test_enclosed_gap_can_have_valid_coverage_and_stable_ids():
    outer = box(*BOUNDS)
    hole = box(25.4, 50.2, 25.6, 50.8)
    rows = {"UA-left": row(box(25, 50, 25.5, 51).difference(hole)),
            "UA-right": row(box(25.5, 50, 26, 51).difference(hole))}
    original = {fid: item["geometry"].wkb for fid, item in rows.items()}
    report = audit(rows, outer, BOUNDS, include_geometry=True)
    assert report["coverage_valid_exact"]
    assert len(report["gaps"]) == 1
    gap = report["gaps"][0]
    assert gap["classification"] == "real_polygon_coverage_gap"
    assert gap["feature_ids"] == ["UA-left", "UA-right"]
    assert gap["internal_country"] and not gap["touches_window_edge"]
    assert gap["triage_category"] == "enclosed_political_gap"
    assert not gap["touches_allowed_surface_boundary"]
    assert gap["allowed_surface_boundary_contact_kind"] == "none"
    assert gap["interactive_feature_ids"] == gap["feature_ids"]
    assert gap["helper_feature_ids"] == []
    assert report["diagnostic_counts"]["triage_category"] == {"enclosed_political_gap": 1}
    assert gap["area_km2"] > 100 and gap["maximum_inscribed_diameter_m"] > 1000
    assert {fid: item["geometry"].wkb for fid, item in rows.items()} == original
    json.dumps(report, allow_nan=False)


def test_protected_water_hole_is_not_a_gap():
    water = box(25.4, 50.2, 25.6, 50.8)
    allowed = box(*BOUNDS).difference(water)
    report = audit({"UA-water": row(allowed)}, allowed, BOUNDS)
    assert report["gaps"] == []
    assert report["rendering_assessment"] == "unconfirmed_requires_same_extent_browser_capture"


def test_reference_distinguishes_geometry_loss_from_shared_gap():
    rows = {"left": row(box(25, 50, 25.4, 51)), "right": row(box(25.6, 50, 26, 51))}
    reference = {"left": row(box(25, 50, 25.5, 51)), "right": row(box(25.5, 50, 26, 51))}
    report = audit(rows, box(*BOUNDS), BOUNDS, reference=reference)
    assert report["gaps"][0]["classification"] == "lod_or_simplification_difference"
    assert report["gaps"][0]["reference_covered_fraction_planar"] == pytest.approx(1)
    assert report["gaps"][0]["touches_window_edge"]
    assert report["gaps"][0]["window_censored"]
    assert report["gaps"][0]["triage_category"] == "window_censored"
    assert not report["gaps"][0]["touches_allowed_surface_boundary"]
    same = audit(rows, box(*BOUNDS), BOUNDS, reference=rows)
    assert same["gaps"][0]["classification"] == "real_polygon_coverage_gap"


def test_partial_reference_coverage_does_not_hide_remaining_real_gap():
    rows = {"left": row(box(25, 50, 25.4, 51)), "right": row(box(25.6, 50, 26, 51))}
    reference = {"left": row(box(25, 50, 25.45, 51)), "right": row(box(25.6, 50, 26, 51))}
    gap = audit(rows, box(*BOUNDS), BOUNDS, reference=reference)["gaps"][0]
    assert gap["classification"] == "partially_reference_covered_gap"
    assert gap["reference_covered_fraction_planar"] == pytest.approx(0.25)


@pytest.mark.parametrize("surface_kind", ["coast", "water"])
def test_surface_boundary_difference_requires_water_review(surface_kind):
    missing = box(25.3, 50.3, 25.5, 50.7)
    if surface_kind == "coast":
        allowed = box(25.1, 50.1, 25.5, 50.9)
    else:
        allowed = box(*BOUNDS).difference(box(25.5, 50.4, 25.8, 50.8))
    report = audit({"land": row(allowed.difference(missing))}, allowed, BOUNDS)
    gap = report["gaps"][0]
    assert gap["classification"] == "real_polygon_coverage_gap"
    assert gap["triage_category"] == "surface_boundary_difference"
    assert gap["touches_allowed_surface_boundary"]
    assert gap["allowed_surface_boundary_contact_kind"] == "linear"
    assert gap["allowed_surface_boundary_contact_length_degrees"] > 0.1
    assert gap["surface_boundary_review_required"]
    assert not gap["window_censored"]
    assert "real water boundaries" in gap["suggested_action"]


@pytest.mark.parametrize("contact_size", [0, 8 * math.ulp(50.8)])
def test_point_or_numerical_surface_contact_does_not_become_coastal_gap(contact_size):
    missing = box(25.3, 50.3, 25.6, 50.8)
    water = box(25.6 - contact_size, 50.8, 25.8, 50.9)
    allowed = box(*BOUNDS).difference(water)
    geometry = allowed.difference(missing)
    original = geometry.wkb
    gap = audit({"land": row(geometry)}, allowed, BOUNDS, include_geometry=True)["gaps"][0]
    assert gap["triage_category"] == "enclosed_political_gap"
    assert not gap["touches_allowed_surface_boundary"]
    assert gap["allowed_surface_boundary_contact_kind"] == (
        "numerical_line_contact" if contact_size else "point_contact")
    assert shape(gap["geometry"]).equals(missing)
    assert geometry.wkb == original


def test_helper_only_gap_keeps_explicit_hints_separate_from_country():
    missing = box(25.3, 50.3, 25.6, 50.8)
    helper = {**row(box(*BOUNDS).difference(missing), "RU"), "interactive": False,
              "scenario_helper_kind": "shell_fallback", "scenario_shell_owner_hint": "GER"}
    report = audit({"RU_ARCTIC_FB_GER_008": helper}, box(*BOUNDS), BOUNDS)
    gap = report["gaps"][0]
    assert gap["classification"] == "real_polygon_coverage_gap"
    assert gap["triage_category"] == "helper_boundary_gap"
    assert gap["political_contact_role"] == "helper_only"
    assert gap["interactive_feature_ids"] == []
    assert gap["helper_feature_ids"] == gap["feature_ids"]
    assert gap["countries"] == ["RU"]
    assert gap["helper_contacts"][0]["scenario_shell_owner_hint"] == "GER"
    assert report["diagnostic_counts"]["political_contact_role"] == {"helper_only": 1}
    assert "not a repair recipient" in gap["suggested_action"]


@pytest.mark.parametrize("fid,properties", [
    (" ru_arctic_fb_legacy ", {}),
    ("legacy", {"name": "Russia SHELL FALLBACK 1"}),
    ("explicit", {"scenario_helper_kind": " Shell_Fallback ", "interactive": True}),
], ids=["id-prefix", "legacy-name", "explicit-kind-with-interactive-true"])
def test_shell_helper_detection_matches_renderer_and_excludes_interactive_contacts(fid, properties):
    missing = box(25.3, 50.3, 25.6, 50.8)
    helper = {**row(box(*BOUNDS).difference(missing)), **properties}
    gap = audit({fid: helper}, box(*BOUNDS), BOUNDS)["gaps"][0]
    assert gap["triage_category"] == "helper_boundary_gap"
    assert gap["political_contact_role"] == "helper_only"
    assert gap["helper_feature_ids"] == [fid]
    assert gap["interactive_feature_ids"] == []
    assert gap["helper_contacts"][0]["interactive_property"] is properties.get("interactive")
    assert helper == {**row(helper["geometry"]), **properties}
    # An unrelated nonempty helper kind does not activate the shell policy.
    ordinary = {**row(helper["geometry"]), "scenario_helper_kind": "other_kind"}
    ordinary_gap = audit({"ordinary": ordinary}, box(*BOUNDS), BOUNDS)["gaps"][0]
    assert ordinary_gap["helper_feature_ids"] == []
    assert ordinary_gap["interactive_feature_ids"] == ["ordinary"]


def test_mixed_helper_interactive_contacts_preserve_legacy_country_diagnostics():
    missing = box(25.4, 50.2, 25.6, 50.8)
    rows = {"interactive": row(box(25, 50, 25.5, 51).difference(missing), "UA"),
            "helper": {**row(box(25.5, 50, 26, 51).difference(missing), "RU"),
                       "interactive": False, "scenario_helper_kind": "shell_fallback"}}
    gap = audit(rows, box(*BOUNDS), BOUNDS)["gaps"][0]
    assert gap["political_contact_role"] == "interactive_and_helper"
    assert gap["interactive_feature_ids"] == ["interactive"]
    assert gap["helper_feature_ids"] == ["helper"]
    assert gap["contact_kind"] == "cross_country"


def test_uncovered_island_has_surface_difference_without_political_contact():
    allowed = box(25.2, 50.2, 25.8, 50.8)
    gap = audit({}, allowed, BOUNDS)["gaps"][0]
    assert gap["triage_category"] == "surface_boundary_difference"
    assert gap["political_contact_role"] == "no_political_contact"
    assert gap["feature_ids"] == []
    assert gap["surface_boundary_review_required"]


def test_window_contact_censors_gap_even_when_surface_contact_exists():
    allowed = box(25.2, 50, 25.8, 50.8)
    report = audit({}, allowed, BOUNDS)
    gap = report["gaps"][0]
    assert gap["triage_category"] == "window_censored"
    assert gap["window_censored"] and gap["touches_allowed_surface_boundary"]
    assert report["diagnostic_counts"]["window_censored"] == 1
    assert report["diagnostic_counts"]["surface_boundary_review_required"] == 1


def test_load_window_preserves_helper_properties_without_owner_sidecar(tmp_path, monkeypatch):
    import tools.audit_tno_east_europe_gaps as module

    geometry = mapping(box(*BOUNDS))
    topology = {"objects": {"political": {"geometries": [
        {"geometry": geometry, "properties": {"id": "helper", "cntr_code": "RU",
         "interactive": False, "scenario_helper_kind": "shell_fallback",
         "scenario_shell_owner_hint": "GER", "name": "Russia Shell Fallback"}},
        {"geometry": geometry, "properties": {"id": "old", "cntr_code": "UA"}}]}}}
    source = tmp_path / "runtime.topo.json"
    source.write_text(json.dumps(topology), encoding="utf-8")
    monkeypatch.setattr(module, "_absolute_topology", lambda value: value)
    monkeypatch.setattr(module, "_decode_geometry", lambda topology, item: shape(item["geometry"]))
    rows, allowed = load_window(source, BOUNDS, surfaces=False)
    assert allowed is None
    assert rows["helper"]["country"] == "RU"
    assert rows["helper"]["scenario_shell_owner_hint"] == "GER"
    assert rows["helper"]["scenario_helper_kind"] == "shell_fallback"
    assert rows["helper"]["interactive"] is False
    assert rows["helper"]["name"] == "Russia Shell Fallback"
    assert rows["old"]["interactive"] is None
    assert rows["old"]["scenario_helper_kind"] == ""


def test_overlap_and_unmatched_edge_vertices_are_reported():
    left = row(box(25, 50, 25.5, 51))
    overlap = audit({"left": left, "right": row(box(25.4, 50, 26, 51))}, box(*BOUNDS), BOUNDS)
    assert not overlap["coverage_valid_exact"]
    assert overlap["edge_findings"][0]["overlap_area_km2"] > 0
    # Identical coverage domain, but one shared segment contains an extra node.
    right = row(Polygon([(25.5, 50), (26, 50), (26, 51), (25.5, 51), (25.5, 50.5)]))
    mismatch = audit({"left": left, "right": right}, box(*BOUNDS), BOUNDS)
    assert mismatch["gaps"] == []
    assert mismatch["edge_findings"][0]["classification"] == "adjacent_edge_mismatch"
    assert mismatch["edge_findings"][0]["overlap_area_km2"] == 0


def test_invalid_geometry_and_mismatched_comparison_ids_fail_closed():
    invalid = Polygon([(25, 50), (26, 51), (26, 50), (25, 51), (25, 50)])
    with pytest.raises(ValueError, match="Invalid broken"):
        audit({"broken": row(invalid)}, box(*BOUNDS), BOUNDS)
    with pytest.raises(ValueError, match="identical political IDs"):
        audit({"one": row(box(*BOUNDS))}, box(*BOUNDS), BOUNDS, reference={})


def test_edge_mismatch_outside_window_does_not_contaminate_local_report():
    left = row(box(25, 49, 25.5, 51))
    right = row(Polygon([(25.5, 49), (26, 49), (26, 51), (25.5, 51), (25.5, 49.5)]))
    report = audit({"left": left, "right": right}, box(*BOUNDS), BOUNDS)
    assert report["coverage_valid_exact"]
    assert report["edge_findings"] == []


def test_real_ukraine_belarus_runtime_sample():
    """Audit published coordinates; this is not a synthetic country's fixture."""
    bounds = (24, 50.5, 29, 52.5)
    rows, allowed = load_window(ROOT / "data/scenarios/tno_1962/runtime_topology.topo.json", bounds)
    assert {"UA", "BY"}.issubset({item["country"] for item in rows.values()})
    report = audit(rows, allowed, bounds, min_area_km2=0.1)
    assert report["feature_count"] > 10
    # This unreviewed mixed-source border has inherited unassigned land.
    mixed = [gap for gap in report["gaps"] if {"UA", "BY"}.issubset(gap["countries"])]
    assert mixed, "UA/BY baseline changed: inspect whether the inherited seam was repaired"
    assert all(gap["feature_ids"] and gap["area_km2"] > 0 for gap in mixed)
    assert not report["canonical_modified"]


def test_cli_output_is_confined_to_new_repository_runtime_path(tmp_path):
    allowed = ROOT / ".runtime" / "reports" / "generated" / "east-audit-output-guard-never-created.json"
    assert checked_runtime_output(allowed) == allowed.resolve()
    existing = tmp_path / "existing.json"
    existing.write_text("{}", encoding="utf-8")
    for forbidden in (ROOT / "data" / "new-audit.json", ROOT / "js" / "new-audit.json",
                      ROOT.parent / "outside-repository.json", ROOT / ".runtime", existing):
        with pytest.raises(ValueError, match="inside_repository_runtime"):
            checked_runtime_output(forbidden)
