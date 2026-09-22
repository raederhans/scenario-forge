"""Coverage validity must not conceal unassigned land or invent water repairs."""
import json

import pytest
from shapely.geometry import Polygon, box

from tools.audit_tno_east_europe_gaps import ROOT, audit, checked_runtime_output, load_window


BOUNDS = (25, 50, 26, 51)


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
    same = audit(rows, box(*BOUNDS), BOUNDS, reference=rows)
    assert same["gaps"][0]["classification"] == "real_polygon_coverage_gap"


def test_partial_reference_coverage_does_not_hide_remaining_real_gap():
    rows = {"left": row(box(25, 50, 25.4, 51)), "right": row(box(25.6, 50, 26, 51))}
    reference = {"left": row(box(25, 50, 25.45, 51)), "right": row(box(25.6, 50, 26, 51))}
    gap = audit(rows, box(*BOUNDS), BOUNDS, reference=reference)["gaps"][0]
    assert gap["classification"] == "partially_reference_covered_gap"
    assert gap["reference_covered_fraction_planar"] == pytest.approx(0.25)


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
    for forbidden in (ROOT / "data" / "new-audit.json", ROOT / "js" / "new-audit.json",
                      tmp_path / "outside-repository.json", ROOT / ".runtime"):
        with pytest.raises(ValueError, match="inside_repository_runtime"):
            checked_runtime_output(forbidden)
