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
