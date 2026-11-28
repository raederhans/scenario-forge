"""Coverage validity must not conceal unassigned land or invent water repairs."""

import pytest
import shapely
from shapely.geometry import Polygon, box

from tools.audit_tno_east_europe_gaps import ROOT, audit, load_window, metrics


BOUNDS = (25, 50, 26, 51)


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
    assert gap["area_km2"] > 100 and gap["maximum_inscribed_diameter_m"] > 1000
    assert {fid: item["geometry"].wkb for fid, item in rows.items()} == original


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
    assert gap["surface_boundary_review_required"]


def test_real_ukraine_belarus_runtime_sample():
    """Audit published coordinates; this is not a synthetic country's fixture."""
    bounds = (24, 50.5, 29, 52.5)
    rows, allowed = load_window(ROOT / "data/scenarios/tno_1962/runtime_topology.topo.json", bounds)
    assert {"UA", "BY"}.issubset({item["country"] for item in rows.values()})
    report = audit(rows, allowed, bounds, min_area_km2=0.1)
    # This unreviewed mixed-source border has inherited unassigned land.
    mixed = [gap for gap in report["gaps"] if {"UA", "BY"}.issubset(gap["countries"])]
    assert mixed, "UA/BY baseline changed: inspect whether the inherited seam was repaired"
    assert all(gap["feature_ids"] and gap["area_km2"] > 0 for gap in mixed)
    assert not report["canonical_modified"]
