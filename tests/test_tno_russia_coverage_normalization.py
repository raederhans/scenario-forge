import pytest
from shapely.geometry import Polygon
from tools.normalize_tno_russia_coverage import normalize_baseline_overlaps

def test_crossing_sourceborder_distributes_overlap():
    baseline = {
        "A": Polygon([(0,0), (4,0), (4,4), (0,4)]),
        "B": Polygon([(2,0), (6,0), (6,4), (2,4)])
    }
    sources = {
        "pA": Polygon([(0,0), (3,0), (3,4), (0,4)]),
        "pB": Polygon([(3,0), (6,0), (6,4), (3,4)])
    }
    parents = {"A": "pA", "B": "pB"}

    result, diag = normalize_baseline_overlaps(baseline, sources, parents)

    # A gets 0..3, B gets 3..6
    assert result["A"].equals(Polygon([(0,0), (3,0), (3,4), (0,4)]))
    assert result["B"].equals(Polygon([(3,0), (6,0), (6,4), (3,4)]))

    # Verify source_resolutions ledger
    assert len(diag["source_resolutions"]) == 2


def test_exclusive_territory_conserved():
    baseline = {
        "A": Polygon([(0,0), (2,0), (2,2), (0,2)]),
        "B": Polygon([(4,0), (6,0), (6,2), (4,2)])
    }
    sources = {
        "pA": Polygon([(0,0), (3,0), (3,3), (0,3)]),
        "pB": Polygon([(3,0), (6,0), (6,3), (3,3)])
    }
    parents = {"A": "pA", "B": "pB"}

    result, diag = normalize_baseline_overlaps(baseline, sources, parents)

    assert result["A"].equals(baseline["A"])
    assert result["B"].equals(baseline["B"])


def test_protected_city_priority():
    baseline = {
        "A": Polygon([(0,0), (4,0), (4,4), (0,4)])
    }
    sources = {
        "pA": Polygon([(0,0), (5,0), (5,5), (0,5)])
    }
    parents = {"A": "pA"}
    protected = {
        "city": Polygon([(1,1), (3,1), (3,3), (1,3)])
    }

    result, diag = normalize_baseline_overlaps(baseline, sources, parents, protected=protected)

    expected = Polygon([(0,0), (4,0), (4,4), (0,4)]).difference(protected["city"])
    assert result["A"].equals(expected)
    assert len(diag["protected_losses"]) == 1
    assert diag["protected_losses"][0]["id"] == "A"


def test_ambiguous_tied_gap_rejects():
    baseline = {
        "A": Polygon([(0,0), (4,0), (4,4), (0,4)]),
        "B": Polygon([(2,0), (6,0), (6,4), (2,4)])
    }
    sources = {
        "pA": Polygon([(0,0), (1,0), (1,4), (0,4)]),
        "pB": Polygon([(5,0), (6,0), (6,4), (5,4)])
    }
    parents = {"A": "pA", "B": "pB"}

    with pytest.raises(ValueError, match="Tie in source-gap distance"):
        normalize_baseline_overlaps(baseline, sources, parents)


def test_sameparent_splits_rejected():
    baseline = {
        "A": Polygon([(0,0), (4,0), (4,4), (0,4)]),
        "B": Polygon([(2,0), (6,0), (6,4), (2,4)])
    }
    sources = {
        "pA": Polygon([(0,0), (6,0), (6,4), (0,4)])
    }
    parents = {"A": "pA", "B": "pA"}

    with pytest.raises(ValueError, match="Same-parent split true overlap"):
        normalize_baseline_overlaps(baseline, sources, parents)


def test_source_supported_split_families_nonoverlap_retained():
    baseline = {
        "A": Polygon([(0,0), (2,0), (2,2), (0,2)]),
        "B": Polygon([(4,0), (6,0), (6,2), (4,2)])
    }
    sources = {
        "pA": Polygon([(0,0), (6,0), (6,2), (0,2)])
    }
    parents = {"A": "pA", "B": "pA"}

    result, diag = normalize_baseline_overlaps(baseline, sources, parents)

    assert result["A"].equals(baseline["A"])
    assert result["B"].equals(baseline["B"])


def test_real_tiny_interior_conflict_not_numerical():
    # Area = 0.5e-5 * 0.5e-5 = 0.25e-10 < 1e-10
    baseline = {
        "A": Polygon([(0,0), (1,0), (1,1), (0,1)]),
        "B": Polygon([(1-0.5e-5, 0.5-0.25e-5), (2, 0.5-0.25e-5), (2, 0.5+0.25e-5), (1-0.5e-5, 0.5+0.25e-5)])
    }
    sources = {
        "pA": Polygon([(0,0), (0.1,0), (0.1,1), (0,1)]),
        "pB": Polygon([(1.9,0), (2,0), (2,1), (1.9,1)])
    }
    parents = {"A": "pA", "B": "pB"}

    with pytest.raises(ValueError, match="Source-gap distance .* > 1000m"):
        normalize_baseline_overlaps(baseline, sources, parents)


def test_erased_id_raises_value_error():
    baseline = {
        "A": Polygon([(0,0), (2,0), (2,2), (0,2)])
    }
    sources = {
        "pA": Polygon([(0,0), (2,0), (2,2), (0,2)])
    }
    parents = {"A": "pA"}
    protected = {
        "city": Polygon([(-1,-1), (3,-1), (3,3), (-1,3)])
    }
    with pytest.raises(ValueError, match="Baseline A completely erased"):
        normalize_baseline_overlaps(baseline, sources, parents, protected=protected)


def test_malformed_parent_input():
    baseline = {
        "A": Polygon([(0,0), (2,0), (2,2), (0,2)])
    }
    sources = {
        "pA": Polygon([(0,0), (2,0), (2,2), (0,2)])
    }
    # Missing parent for A
    parents = {}
    with pytest.raises(ValueError, match="exact parent keys"):
        normalize_baseline_overlaps(baseline, sources, parents)


def test_source_gap_near_border_unique():
    # Gap overlap but source is near border uniquely, distance < 1000m
    # Use 0.001 degrees scale
    baseline = {
        "A": Polygon([(0,0), (0.004,0), (0.004,0.004), (0,0.004)]),
        "B": Polygon([(0.002,0), (0.006,0), (0.006,0.004), (0.002,0.004)])
    }
    sources = {
        # pA source is close to overlap (0.002..0.004)
        "pA": Polygon([(0,0), (0.0015,0), (0.0015,0.004), (0,0.004)]),
        # pB source is further
        "pB": Polygon([(0.005,0), (0.006,0), (0.006,0.004), (0.005,0.004)])
    }
    parents = {"A": "pA", "B": "pB"}

    result, diag = normalize_baseline_overlaps(baseline, sources, parents)

    assert len(diag["gap_resolutions"]) == 1
    assert diag["gap_resolutions"][0]["winner"] == "A"
    assert result["A"].equals(baseline["A"])
    assert result["B"].equals(Polygon([(0.004,0), (0.006,0), (0.006,0.004), (0.004,0.004)]))

def test_source_gap_near_border_ambiguous():
    baseline = {
        'A': Polygon([(0,0), (0.04,0), (0.04,0.04), (0,0.04)]),
        'B': Polygon([(0.02,0), (0.06,0), (0.06,0.04), (0.02,0.04)])
    }
    sources = {
        'pA': Polygon([(0,0), (0.015,0), (0.015,0.04), (0,0.04)]),
        'pB': Polygon([(0.045,0), (0.06,0), (0.06,0.04), (0.045,0.04)])
    }
    parents = {'A': 'pA', 'B': 'pB'}
    with pytest.raises(ValueError, match='Tie in source-gap distance'):
        normalize_baseline_overlaps(baseline, sources, parents)
