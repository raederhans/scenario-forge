import shapely
from shapely.geometry import Polygon, box

from map_builder.coverage_validation import coverage_is_valid_exact


def test_touching_holes_keep_exact_surfaces_and_pass_definition():
    left = Polygon([(0, 0), (10, 0), (10, 5), (10, 10), (0, 10)],
                   [[(2, 2), (8, 2), (10, 5)]])
    right = Polygon([(10, 0), (20, 0), (20, 10), (10, 10), (10, 5)],
                    [[(12, 2), (18, 2), (10, 5)]])
    original = [left.wkb, right.wkb]
    diagnostics = {}
    assert coverage_is_valid_exact([left, right], diagnostics)
    assert [left.wkb, right.wkb] == original
    assert left.relate_pattern(right, 'F********')


def test_rejects_true_overlap_even_when_very_small():
    assert not coverage_is_valid_exact([box(0, 0, 1, 1), box(1 - 1e-12, 0, 2, 1)])


def test_rejects_unmatched_collinear_node():
    left = Polygon([(0, 0), (1, 0), (1, .5), (1, 1), (0, 1)])
    assert not coverage_is_valid_exact([left, box(1, 0, 2, 1)])


def test_rejects_unnoded_point_contact():
    assert not coverage_is_valid_exact([box(0, 0, 1, 1), Polygon([(1, .5), (2, 0), (2, 1)])])


def test_rejects_duplicate_and_invalid_polygon():
    assert not coverage_is_valid_exact([box(0, 0, 1, 1)] * 2)
    assert not coverage_is_valid_exact([Polygon([(0, 0), (1, 1), (1, 0), (0, 1)])])


def test_accepts_exact_shared_edge_and_uncovered_hole():
    assert coverage_is_valid_exact([box(0, 0, 1, 1), box(1, 0, 2, 1)])
    assert coverage_is_valid_exact([Polygon([(0, 0), (3, 0), (3, 3), (0, 3)],
                                            [[(1, 1), (2, 1), (2, 2), (1, 2)]])])
